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
import { searchFights, handleSearchAbort } from './search.js';
import { Report, EncounterQuery, SearchContext } from './models.js';

// ===== 전역 상태 =====
const rankingCache = new RankingCache();
let lastSearchParams = null;
let globalApiInstance = null; // 전역 API 인스턴스 (싱글톤)
let searchCancelled = false; // 검색 취소 플래그

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

    // 검색 시작 시 취소 플래그 초기화
    searchCancelled = false;

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
        const reportData = await api.getAnonymousReport(reportCode);

        // Report 인스턴스 생성
        const report = new Report(reportData, reportCode);

        // Fight 필터링
        const { fights, specifiedFightId, allFights } = report.filterFights(fightId);

        // Region 및 Partition 감지
        const region = report.getRegion();
        const partition = report.getPartition(region);

        // Encounter의 정확한 파티션 이름 조회
        showLoading('파티션 정보', '조회 중...');
        const firstFight = report.getFirstFight();
        const partitions = await api.getEncounterPartitions(firstFight.encounterID);

        const partitionData = partitions.find(p => p.id === partition);
        const partitionName = partitionData?.compactName || null;

        // 파티션 표시 생성
        let partitionText = `P${partition}`;
        if (partitionName) {
            partitionText = `P${partition} - ${partitionName}`;
        }
        const regionText = `(${region || '전체'}, ${partitionText})`;
        showLoading(`${fights.length}개의 전투 ${regionText}`, '분석 중...');

        // EncounterQuery 생성 (첫 번째 fight 기준)
        const encounterQuery = EncounterQuery.fromFight(firstFight, region, partition, partitionName);

        // 검색 파라미터 저장 (재검색용)
        lastSearchParams = encounterQuery.toSearchParams(report.startTime);

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

        // SearchContext 생성
        const context = new SearchContext(api, rankingCache);

        // 진행 상황 콜백: 여러 파이트 검색 모드에서 즉시 결과 표시
        let isFirstResult = true;
        const progressCallback = isMultipleSearchMode ? async (matches, rankingsData, fight) => {
            // 검색이 취소되었으면 결과 표시하지 않음
            if (searchCancelled) return;

            const matchedFightInfo = {
                encounterId: fight.encounterID,
                difficulty: fight.difficulty,
                size: fight.size,
                region: region,
                partition: partition
            };

            await displayResults(matches, api, rankingsData, rankingCache, matchedFightInfo, report.code, !isFirstResult);
            isFirstResult = false;
        } : null;

        // 공통 검색 함수 사용
        const result = await searchFights(
            report,
            encounterQuery,
            context,
            {
                fights: fightsList,
                startIndex: 0,
                multipleSearchMode: isMultipleSearchMode,
                progressCallback
            }
        );

        // 검색이 취소되었으면 결과 표시하지 않음
        if (searchCancelled) {
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

            await displayResults(result.allMatches, api, result.allRankingsData, rankingCache, matchedFightInfo, report.code);
        }

    } catch (error) {
        // 취소된 경우 이미 처리됨 (stopSearch에서)
        if (searchCancelled) {
            return;
        }
        hideLoading();
        showError(error.message);
        console.error('오류:', error);
    }
}

/**
 * 검색을 중단합니다
 */
async function stopSearch() {
    if (globalApiInstance) {
        // 취소 플래그 설정 (UI 레벨 차단)
        searchCancelled = true;

        await handleSearchAbort(rankingCache, globalApiInstance);
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

    // 이벤트 리스너 등록
    document.getElementById('searchBtn').addEventListener('click', startSearch);
    document.getElementById('stopBtn').addEventListener('click', stopSearch);
    document.getElementById('openSettingsBtn').addEventListener('click', openSettingsModal);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    document.getElementById('openCacheBtn').addEventListener('click', () => openCacheModal(rankingCache));
    document.getElementById('closeCacheBtn').addEventListener('click', closeCacheModal);
    document.getElementById('exportCacheBtn').addEventListener('click', () => exportCache(rankingCache));
    document.getElementById('importCacheBtn').addEventListener('click', () => {
        document.getElementById('cacheImportInput').click();
    });
    document.getElementById('clearAllCacheBtn').addEventListener('click', () => clearAllCache(rankingCache));
    document.getElementById('cacheImportInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            importCache(rankingCache, file);
            event.target.value = ''; // 파일 입력 초기화
        }
    });

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

// ===== 전역 함수 노출 (동적 생성 요소 및 디버깅용) =====
// 동적으로 생성되는 버튼들이 사용하는 함수들
window.clearEncounterCache = (encounterId, region, partition, encounterName, partitionName) =>
    clearEncounterCache(rankingCache, encounterId, region, partition, encounterName, partitionName);
window.refreshCacheAndSearch = () => refreshCacheAndSearch(rankingCache, lastSearchParams, startSearch);

// 디버깅 및 개발용 전역 접근
window.rankingCache = rankingCache;
Object.defineProperty(window, 'lastSearchParams', {
    get: () => lastSearchParams
});
