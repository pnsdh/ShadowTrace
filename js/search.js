import { SEARCH_CONSTANTS, ANONYMOUS_NAMES } from './constants.js';
import { LogMatcher } from './matcher.js';
import { showLoading, updateCacheDisplay } from './ui.js';
import { getEncounterRankings, getEncounterRankingsBatch, findMaxPages } from './rankings.js';

/**
 * 검색 로직 모듈
 * FFLogs 데이터 검색 및 매칭 관련 핵심 로직을 담당합니다
 */

/**
 * 리포트에서 region을 자동 감지합니다
 * @param {Object} report - FFLogs 리포트 데이터
 * @returns {string|null} 감지된 region (KR, NA, EU 등) 또는 null
 */
export function detectRegion(report) {
    if (report.rankings && report.rankings.data && report.rankings.data.length > 0) {
        const rankingData = report.rankings.data[0];
        // roles 안의 첫 번째 캐릭터에서 region 추출
        for (const roleKey in rankingData.roles || {}) {
            const role = rankingData.roles[roleKey];
            if (role.characters && role.characters.length > 0) {
                const firstChar = role.characters[0];
                if (firstChar.server && firstChar.server.region) {
                    const region = firstChar.server.region;
                    return region;
                }
            }
        }
    }

    return null;
}

/**
 * 리포트에서 partition을 결정합니다
 * @param {Object} report - FFLogs 리포트 데이터
 * @param {string|null} region - 감지된 region
 * @returns {Object} { partition: number, partitionName: string|null }
 */
export function detectPartition(report, region) {
    // rankings 데이터에서 partition 추출
    if (report.rankings && report.rankings.data && report.rankings.data.length > 0) {
        const partition = report.rankings.data[0].partition;

        // zone.partitions에서 해당 partition의 이름 찾기
        let partitionName = null;
        if (report.zone && report.zone.partitions) {
            const partitionInfo = report.zone.partitions.find(p => p.id === partition);
            if (partitionInfo && partitionInfo.compactName) {
                partitionName = partitionInfo.compactName;
            }
        }

        return { partition, partitionName };
    }

    // partition이 없으면 기본값 사용
    const partition = (region === 'KR') ? SEARCH_CONSTANTS.KR_PARTITION : SEARCH_CONSTANTS.DEFAULT_PARTITION;
    return { partition, partitionName: null };
}

/**
 * Fight 목록을 필터링하고 준비합니다
 * @param {Object} report - FFLogs 리포트 데이터
 * @param {number|string|null} fightId - Fight ID (숫자, 'last', 또는 null)
 * @returns {Object} { fights, specifiedFightId, allFights }
 */
export function filterAndPrepareFights(report, fightId) {
    let allFights = report.fights.filter(f => f.encounterID > 0); // 모든 보스 전투
    let fights = [...allFights]; // 복사본
    let specifiedFightId = fightId;

    // 'last' 처리
    if (fightId === 'last') {
        if (fights.length > 0) {
            fightId = fights[fights.length - 1].id;
            specifiedFightId = fightId;
        } else {
            throw new Error('보스 전투를 찾을 수 없습니다.');
        }
    }

    // 지정된 fight가 있으면 우선 검색
    if (fightId) {
        const specifiedFights = fights.filter(f => f.id === fightId);
        if (specifiedFights.length === 0) {
            throw new Error(`Fight ID ${fightId}를 찾을 수 없습니다.`);
        }
        fights = specifiedFights;
    }

    if (fights.length === 0) {
        throw new Error('분석할 보스 전투를 찾을 수 없습니다.');
    }

    return { fights, specifiedFightId, allFights };
}

/**
 * 공통 파이트 검색 함수
 * @param {Array} fights - 검색할 fight 목록
 * @param {Object} report - FFLogs 리포트 데이터
 * @param {string} reportCode - 리포트 코드
 * @param {FFLogsAPI} api - API 인스턴스
 * @param {string|null} region - 지역
 * @param {number} partition - 파티션 번호
 * @param {string|null} partitionName - 파티션 이름
 * @param {AbortSignal} signal - 중단 신호
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @param {number} startIndex - 시작 인덱스
 * @param {boolean} multipleSearchMode - 여러 파이트 검색 모드
 * @param {Function|null} progressCallback - 진행 상황 콜백
 * @returns {Promise<Object>} { allMatches, allRankingsData, matchedFight, aborted }
 */
export async function searchFights(fights, report, reportCode, api, region, partition, partitionName, signal, rankingCache, startIndex = 0, multipleSearchMode = false, progressCallback = null) {
    const allMatches = [];
    const allRankingsData = [];
    let currentFightIndex = startIndex;
    let matchedFight = null;

    // 캐시가 있는 fight를 우선적으로 배치
    const fightsWithCache = [];
    const fightsWithoutCache = [];

    for (const fight of fights) {
        const hasCache = await rankingCache.hasCacheForFight(
            fight.encounterID,
            fight.difficulty,
            fight.size,
            region,
            partition
        );
        if (hasCache) {
            fightsWithCache.push(fight);
        } else {
            fightsWithoutCache.push(fight);
        }
    }

    const sortedFights = [...fightsWithCache, ...fightsWithoutCache];
    const totalFights = sortedFights.length;

    // 파티션 표시 생성
    let partitionText = `P${partition}`;
    if (partitionName) {
        partitionText = `P${partition} - ${partitionName}`;
    }
    const regionText = region ? ` (${region}, ${partitionText})` : ` (전체, ${partitionText})`;

    for (const fight of sortedFights) {
        if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

        currentFightIndex++;
        const fightProgressText = totalFights > 1 ? ` [${currentFightIndex}/${totalFights}]` : '';

        // 캐시 존재 여부 확인
        const hasCache = await rankingCache.hasCacheForFight(
            fight.encounterID,
            fight.difficulty,
            fight.size,
            region,
            partition
        );

        // 최대 페이지 수 확인
        let estimatedMaxPages = null;
        let cachedMaxPage = null; // 캐시된 최대 페이지

        if (hasCache) {
            cachedMaxPage = await rankingCache.getCachedMaxPage(
                fight.encounterID,
                fight.difficulty,
                fight.size,
                region,
                partition
            );

            estimatedMaxPages = cachedMaxPage || '?';
        } else {
            const mainStatus = `${fight.name}${fightProgressText} (${region || '전체'}, ${partitionText})`;
            const detailStatus = `전체 페이지 수 확인 중...`;
            showLoading(mainStatus, detailStatus);
            estimatedMaxPages = await findMaxPages(
                api,
                fight.encounterID,
                fight.difficulty,
                fight.size,
                region,
                partition,
                rankingCache,
                partitionName,
                signal
            );
        }

        if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

        // 포인트 체크는 query() 메서드에서 자동으로 수행됨

        const matcher = new LogMatcher(fight, report.startTime, reportCode);

        let page = 1;
        let hasMorePages = true;
        const fightMatches = [];
        const fightRankingsData = [];

        if (hasCache) {
            const mainStatus = `${fight.name}${fightProgressText} (${region || '전체'}, ${partitionText})`;
            const detailStatus = `매칭 중...`;
            showLoading(mainStatus, detailStatus);
        }

        const MAX_BATCH_SIZE = SEARCH_CONSTANTS.MAX_BATCH_SIZE;
        const maxPage = hasCache && cachedMaxPage ? cachedMaxPage : estimatedMaxPages;

        while (hasMorePages && page <= SEARCH_CONSTANTS.MAX_PAGES) {
            if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

            // 캐시 모드에서 현재 페이지가 캐시된 최대 페이지를 초과하면 종료
            if (hasCache && cachedMaxPage && page > cachedMaxPage) {
                break;
            }

            // 남은 페이지 계산
            const remainingPages = maxPage ? maxPage - page + 1 : 999;

            // 동적 배치 사이즈 계산
            // query() 메서드에서 자동으로 대기하므로 여기서는 크기만 결정
            const availablePoints = api.getAvailablePointSlots();
            const dynamicBatchSize = Math.min(
                MAX_BATCH_SIZE,
                availablePoints || 999,
                remainingPages,
                estimatedMaxPages ? estimatedMaxPages - page + 1 : 999  // 최대 페이지를 넘지 않도록 제한
            );

            if (dynamicBatchSize <= 0) {
                console.warn('동적 배치 크기가 0 이하입니다. 루프 중단.');
                break;
            }

            // 로딩 메시지
            if (!hasCache) {
                const regionInfo = region ? `${region}` : '전체';
                const progressInfo = `${page}-${Math.min(page + dynamicBatchSize - 1, estimatedMaxPages)}/${estimatedMaxPages}`;
                const mainStatus = `${fight.name}${fightProgressText} (${regionInfo}, ${partitionText})`;
                const detailStatus = `랭킹 페이지 검색 중: ${progressInfo} [배치: ${dynamicBatchSize}개]`;
                showLoading(mainStatus, detailStatus);
            }

            // 배치 요청 (재시도 포함)
            let batchResults;
            const MAX_RETRIES = SEARCH_CONSTANTS.MAX_RETRIES;

            for (let retry = 0; retry <= MAX_RETRIES; retry++) {
                try {
                    batchResults = await getEncounterRankingsBatch(
                        api,
                        fight.encounterID,
                        fight.difficulty,
                        fight.size,
                        region,
                        page,
                        dynamicBatchSize,
                        partition,
                        rankingCache,
                        hasCache ? null : async () => await updateCacheDisplay(rankingCache),
                        partitionName,
                        signal
                    );
                    break; // 성공

                } catch (error) {
                    if (retry < MAX_RETRIES) {
                        // 재시도: 잠시 대기 후 재시도
                        console.warn(`[배치 실패 ${retry + 1}/${MAX_RETRIES + 1}] ${error.message}, 재시도...`);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
                        if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };
                    } else {
                        // 최종 실패: 전체 취소
                        console.error(`[배치 최종 실패] ${error.message}`);
                        throw new Error(`데이터 요청 실패: ${error.message}. 검색을 중단합니다.`);
                    }
                }
            }

            // 각 페이지 결과 처리
            for (const rankings of batchResults) {
                if (!rankings || !rankings.rankings || !Array.isArray(rankings.rankings)) {
                    console.warn('유효하지 않은 랭킹 데이터:', rankings);
                    hasMorePages = false;
                    break;
                }

                fightRankingsData.push(rankings);

                for (const ranking of rankings.rankings) {
                    if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

                    if (!ranking || !ranking.report) {
                        console.warn('유효하지 않은 랭킹 항목:', ranking);
                        continue;
                    }

                    if (ANONYMOUS_NAMES.includes(ranking.name)) {
                        continue;
                    }

                    const result = matcher.match(ranking);
                    if (result.matched) {
                        fightMatches.push({
                            ...result,
                            fightName: fight.name,
                            fightId: fight.id
                        });
                    }
                }

                // 마지막 배치의 마지막 페이지에서 hasMorePages 확인
                if (rankings === batchResults[batchResults.length - 1]) {
                    hasMorePages = rankings.hasMorePages;
                }
            }

            page += dynamicBatchSize;
        }

        // 현재 fight의 모든 페이지 검색 완료 후 매칭 성공 체크
        if (fightMatches.length > 0) {
            // RDPS 검증 수행
            const mainStatus = `${fight.name}${fightProgressText} (${region || '전체'}, ${partitionText})`;
            const detailStatus = `매칭 결과 검증 중...`;
            showLoading(mainStatus, detailStatus);

            const verifiedMatches = [];
            for (const match of fightMatches) {
                if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

                const isVerified = await matcher.verifyRDPS(
                    match.ranking.report.code,
                    match.ranking.report.fightID,
                    api,
                    signal
                );

                if (isVerified) {
                    verifiedMatches.push(match);
                }
            }

            // 검증된 매칭이 있으면 결과에 추가
            if (verifiedMatches.length > 0) {
                allMatches.push(...verifiedMatches);
                allRankingsData.push(...fightRankingsData);

                // 첫 번째 매칭된 fight 기록
                if (!matchedFight) {
                    matchedFight = fight;
                }

                // 여러 파이트 검색 모드에서는 즉시 결과 표시
                if (multipleSearchMode && progressCallback) {
                    await progressCallback(verifiedMatches, fightRankingsData, fight);
                }

                // 단일 파이트 모드에서는 즉시 반환
                if (!multipleSearchMode) {
                    return {
                        allMatches,
                        allRankingsData,
                        matchedFight,
                        aborted: false
                    };
                }
            }
        }
    }

    return { allMatches, allRankingsData, matchedFight, aborted: false };
}

/**
 * 검색 중단 처리
 * @param {AbortController|null} abortController - 중단 컨트롤러
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @returns {AbortController|null} null 반환 (초기화)
 */
export async function handleSearchAbort(abortController, rankingCache) {
    if (abortController) {
        abortController.abort();
        await rankingCache.abortSearch();
        await updateCacheDisplay(rankingCache);
        return null;
    }
    return abortController;
}
