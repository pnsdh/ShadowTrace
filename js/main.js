/**
 * ShadowTrace - FFLogs Anonymous Finder
 * 메인 엔트리 포인트
 */

import { STORAGE_KEYS } from './constants.js';
import { RankingCache } from './cache.js';
import { FFLogsAPI } from './api.js';
import { showLoading, hideLoading, showError, hideError, updateCacheDisplay, displayResults } from './ui.js';
import { openSettingsModal, closeSettingsModal, openCacheModal, closeCacheModal, setupModalClickOutside, isAnyModalOpen } from './modal.js';
import { saveSettings, saveApiKeys, loadSavedApiKeys } from './settings.js';
import { loadApiUsage } from './api.js';
import { clearEncounterCache, clearAllCache, refreshCacheAndSearch, exportCache, importCache } from './cache-manager.js';
import { detectRegion, detectPartition, filterAndPrepareFights, searchFights, handleSearchAbort } from './search.js';

// ===== 전역 상태 =====
const rankingCache = new RankingCache();
let currentSearchAbortController = null;
let lastSearchParams = null;
let globalApiInstance = null; // 전역 API 인스턴스 (싱글톤)

// ===== 메인 검색 함수 =====
/**
 * 익명 로그에서 원본 로그를 검색합니다
 */
async function startSearch() {
    hideError();
    document.getElementById('results').classList.remove('active');

    // 입력값 검증
    const clientId = document.getElementById('clientId').value.trim();
    const clientSecret = document.getElementById('clientSecret').value.trim();
    const anonymousUrl = document.getElementById('anonymousUrl').value.trim();

    if (!clientId || !clientSecret) {
        showError('API 설정에서 Client ID와 Client Secret을 입력한 뒤 사용하세요.');
        return;
    }

    if (!anonymousUrl) {
        showError('익명 로그 URL을 입력하세요.');
        return;
    }

    // URL에서 report code 추출
    const codeMatch = anonymousUrl.match(/reports\/(a:[A-Za-z0-9]+)/);
    if (!codeMatch) {
        showError('올바른 익명 로그 URL이 아닙니다. (a:로 시작해야 합니다)');
        return;
    }

    const reportCode = codeMatch[1];

    // URL에서 fight ID 추출 (?fight=7 또는 #fight=7 형식)
    let fightId = null;
    const urlFightMatch = anonymousUrl.match(/[?#&]fight=(\d+|last)/i);
    if (urlFightMatch) {
        if (urlFightMatch[1] === 'last') {
            fightId = 'last';
        } else {
            fightId = parseInt(urlFightMatch[1]);
        }
    }

    // 옵션: 결과가 없으면 다른 파이트도 검색
    const shouldSearchAllFights = document.getElementById('searchAllFights').checked;

    // API 키 저장
    saveApiKeys();

    // AbortController 생성
    currentSearchAbortController = new AbortController();
    const signal = currentSearchAbortController.signal;

    try {
        const mainStatus = '초기화';
        const detailStatus = '캐시 초기화 중...';
        showLoading(mainStatus, detailStatus);
        await rankingCache.init();

        showLoading('익명 로그', '정보를 가져오는 중...');

        // 전역 API 인스턴스 가져오기 또는 생성
        if (!globalApiInstance || globalApiInstance.clientId !== clientId) {
            if (globalApiInstance) {
                globalApiInstance.stopPeriodicUpdate();
            }
            globalApiInstance = new FFLogsAPI(clientId, clientSecret);
        }
        const api = globalApiInstance;
        api.resetUsageTracking();

        // 익명 로그 정보 가져오기
        const report = await api.getAnonymousReport(reportCode, signal);
        if (signal.aborted) return;

        // Fight 필터링
        const { fights, specifiedFightId, allFights } = filterAndPrepareFights(report, fightId);

        // Region 및 Partition 감지
        const region = detectRegion(report);
        const partition = detectPartition(report, region);

        // Encounter의 정확한 파티션 이름 조회
        showLoading('파티션 정보', '조회 중...');
        const partitions = await api.getEncounterPartitions(fights[0].encounterID, signal);
        if (signal.aborted) return;

        const partitionData = partitions.find(p => p.id === partition);
        const partitionName = partitionData?.compactName || null;

        // 파티션 표시 생성
        let partitionText = `P${partition}`;
        if (partitionName) {
            partitionText = `P${partition} - ${partitionName}`;
        }
        const regionText = `(${region || '전체'}, ${partitionText})`;
        showLoading(`${fights.length}개의 전투 ${regionText}`, '분석 중...');

        // 검색 파라미터 저장 (재검색용)
        lastSearchParams = {
            encounterId: fights[0].encounterID,
            difficulty: fights[0].difficulty,
            size: fights[0].size,
            region: region,
            partition: partition,
            reportStartTime: report.startTime
        };

        // 검색 시작 (새 캐시 추적)
        rankingCache.startSearch();

        // 여러 파이트 검색 모드 판단
        const isMultipleSearchMode = !specifiedFightId || shouldSearchAllFights;

        // 검색할 파이트 결정
        let fightsList = fights;
        if (specifiedFightId && shouldSearchAllFights) {
            // 옵션이 활성화된 경우: 지정된 파이트 + 나머지 파이트
            fightsList = allFights;
        } else if (!specifiedFightId) {
            // URL에 파이트 지정이 없는 경우: 모든 파이트
            fightsList = allFights;
        }

        // 진행 상황 콜백: 여러 파이트 검색 모드에서 즉시 결과 표시
        let isFirstResult = true;
        const progressCallback = isMultipleSearchMode ? async (matches, rankingsData, fight) => {
            const matchedFightInfo = {
                encounterId: fight.encounterID,
                difficulty: fight.difficulty,
                size: fight.size,
                region: region,
                partition: partition
            };

            await displayResults(matches, api, rankingsData, rankingCache, matchedFightInfo, reportCode, !isFirstResult);
            isFirstResult = false;
        } : null;

        // 공통 검색 함수 사용
        const result = await searchFights(
            fightsList,
            report,
            reportCode,
            api,
            region,
            partition,
            partitionName,
            signal,
            rankingCache,
            0,
            isMultipleSearchMode,
            progressCallback
        );

        if (result.aborted) {
            await rankingCache.abortSearch();
            await updateCacheDisplay(rankingCache);
            hideLoading();
            showError('검색이 중단되었습니다.');
            return;
        }

        // 검색 완료
        rankingCache.finishSearch();
        hideLoading();

        // 여러 파이트 검색 모드에서는 이미 progressCallback으로 결과를 표시했으므로
        // 최종 결과 표시는 생략 (결과가 없을 때만 표시)
        if (!isMultipleSearchMode || result.allMatches.length === 0) {
            const matchedFightInfo = result.matchedFight ? {
                encounterId: result.matchedFight.encounterID,
                difficulty: result.matchedFight.difficulty,
                size: result.matchedFight.size,
                region: region,
                partition: partition
            } : (fights.length > 0 ? {
                encounterId: fights[0].encounterID,
                difficulty: fights[0].difficulty,
                size: fights[0].size,
                region: region,
                partition: partition
            } : null);

            await displayResults(result.allMatches, api, result.allRankingsData, rankingCache, matchedFightInfo, reportCode);
        }

    } catch (error) {
        if (error.name === 'AbortError' || currentSearchAbortController?.signal.aborted) {
            await rankingCache.abortSearch();
            await updateCacheDisplay(rankingCache);
            hideLoading();
            showError('검색이 중단되었습니다.');
            return;
        }
        hideLoading();
        showError(error.message);
        console.error('Error:', error);
    } finally {
        currentSearchAbortController = null;
    }
}

/**
 * 검색을 중단합니다
 */
async function stopSearch() {
    if (currentSearchAbortController) {
        currentSearchAbortController = await handleSearchAbort(currentSearchAbortController, rankingCache);
        hideLoading();
        showError('검색이 중단되었습니다.');
    }
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', async () => {
    // 저장된 API 키 로드
    const { savedClientId, savedClientSecret } = loadSavedApiKeys();

    // 체크박스 상태 복원 (기본값: false)
    const savedSearchAllFights = localStorage.getItem(STORAGE_KEYS.SEARCH_ALL_FIGHTS);
    document.getElementById('searchAllFights').checked = savedSearchAllFights === 'true';

    // IndexedDB 캐시 초기화
    await rankingCache.init();

    // API 설정이 되어있으면 전역 인스턴스 생성 및 사용량 표시
    if (savedClientId && savedClientSecret) {
        globalApiInstance = new FFLogsAPI(savedClientId, savedClientSecret);
        await loadApiUsage(savedClientId, savedClientSecret, globalApiInstance);
    }

    // 모달 외부 클릭 이벤트 설정
    setupModalClickOutside();

    // 익명 로그 URL 입력창에 자동 포커스
    document.getElementById('anonymousUrl').focus();
});

// Enter 키 지원 (모달이 열려있지 않을 때만)
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        // 모달이 하나라도 열려있으면 무시
        if (isAnyModalOpen()) {
            return;
        }

        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn.style.display !== 'none') {
            startSearch();
        }
    }
});

// Ctrl+V 붙여넣기 지원 (모달이 열려있지 않을 때만)
document.addEventListener('paste', (e) => {
    // 모달이 열려있으면 무시
    if (isAnyModalOpen()) {
        return;
    }

    const anonymousUrlInput = document.getElementById('anonymousUrl');

    // 이미 입력창에 포커스되어 있으면 기본 동작 사용
    if (document.activeElement === anonymousUrlInput) {
        return;
    }

    // paste 이벤트에서 클립보드 데이터 읽기 (권한 불필요)
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
        e.preventDefault();
        anonymousUrlInput.value = text;
        anonymousUrlInput.focus();
        // 커서를 끝으로 이동
        anonymousUrlInput.setSelectionRange(text.length, text.length);
    }
});

// 체크박스 변경 시 저장
document.addEventListener('DOMContentLoaded', () => {
    const searchAllFightsCheckbox = document.getElementById('searchAllFights');
    searchAllFightsCheckbox.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.SEARCH_ALL_FIGHTS, e.target.checked.toString());
    });
});

// ===== 전역 함수 노출 (HTML onclick에서 사용) =====
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openCacheModal = () => openCacheModal(rankingCache);
window.closeCacheModal = closeCacheModal;
window.saveSettings = saveSettings;
window.clearEncounterCache = (encounterId, region, partition, encounterName, partitionName) =>
    clearEncounterCache(rankingCache, encounterId, region, partition, encounterName, partitionName);
window.clearAllCache = () => clearAllCache(rankingCache);
window.startSearch = startSearch;
window.stopSearch = stopSearch;
window.refreshCacheAndSearch = () => refreshCacheAndSearch(rankingCache, lastSearchParams, startSearch);
window.exportCache = () => exportCache(rankingCache);
window.handleImportCache = (event) => {
    const file = event.target.files[0];
    if (file) {
        importCache(rankingCache, file);
        event.target.value = ''; // 파일 입력 초기화
    }
};
window.rankingCache = rankingCache;
Object.defineProperty(window, 'lastSearchParams', {
    get: () => lastSearchParams
});
