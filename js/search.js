import { SEARCH_CONSTANTS, ANONYMOUS_NAMES } from './constants.js';
import { LogMatcher } from './matcher.js';
import { showLoading, updateCacheDisplay } from './ui.js';
import { getEncounterRankingsBatch, findMaxPages } from './rankings.js';

/**
 * 검색 로직 모듈
 * FFLogs 데이터 검색 및 매칭 관련 핵심 로직을 담당합니다
 */

/**
 * 공통 파이트 검색 함수
 * @param {Report} report - Report 인스턴스
 * @param {EncounterQuery} encounterQuery - Encounter 쿼리 파라미터
 * @param {SearchContext} context - 검색 컨텍스트 (api, rankingCache)
 * @param {Object} options - 검색 옵션
 * @param {number} options.startIndex - 시작 인덱스
 * @param {boolean} options.multipleSearchMode - 여러 파이트 검색 모드
 * @param {Function|null} options.progressCallback - 진행 상황 콜백
 * @param {Array} options.fights - 검색할 fight 목록 (필수)
 * @returns {Promise<Object>} { allMatches, allRankingsData, matchedFight }
 * @throws {AbortError} 검색이 취소된 경우
 */
export async function searchFights(report, encounterQuery, context, options = {}) {
    const {
        startIndex = 0,
        multipleSearchMode = false,
        progressCallback = null,
        fights
    } = options;

    if (!fights || !Array.isArray(fights)) {
        throw new Error('options.fights is required and must be an array');
    }

    const { api, rankingCache } = context;
    const { region, partition, partitionName } = encounterQuery;
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

            // Fight별 EncounterQuery 생성
            const fightQuery = {
                encounterId: fight.encounterID,
                difficulty: fight.difficulty,
                size: fight.size,
                region,
                partition,
                partitionName
            };
            estimatedMaxPages = await findMaxPages(fightQuery, context);
        }

        // 포인트 체크는 query() 메서드에서 자동으로 수행됨

        const matcher = new LogMatcher(fight, report.startTime, report.code);

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

        // Fight별 EncounterQuery 생성
        const fightQuery = {
            encounterId: fight.encounterID,
            difficulty: fight.difficulty,
            size: fight.size,
            region,
            partition,
            partitionName
        };

        while (hasMorePages && page <= SEARCH_CONSTANTS.MAX_PAGES) {
            // 캐시 모드에서 현재 페이지가 캐시된 최대 페이지를 초과하면 종료
            if (hasCache && cachedMaxPage && page > cachedMaxPage) {
                break;
            }

            // 남은 페이지 계산
            const remainingPages = maxPage ? maxPage - page + 1 : SEARCH_CONSTANTS.MAX_PAGES;

            // 동적 배치 사이즈 계산
            // query() 메서드에서 자동으로 대기하므로 여기서는 크기만 결정
            const availablePoints = api.getAvailablePointSlots();
            const dynamicBatchSize = Math.min(
                MAX_BATCH_SIZE,
                availablePoints || SEARCH_CONSTANTS.MAX_PAGES,
                remainingPages,
                estimatedMaxPages ? estimatedMaxPages - page + 1 : SEARCH_CONSTANTS.MAX_PAGES
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
                        fightQuery,
                        page,
                        dynamicBatchSize,
                        context,
                        hasCache ? null : async () => await updateCacheDisplay(rankingCache)
                    );
                    break; // 성공

                } catch (error) {
                    // AbortError는 무시 (정상 취소)
                    if (error.name === 'AbortError') {
                        break;
                    }

                    if (retry < MAX_RETRIES) {
                        // 재시도: 잠시 대기 후 재시도
                        console.warn(`[배치 실패 ${retry + 1}/${MAX_RETRIES + 1}] ${error.message}, 재시도...`);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
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
                const isVerified = await matcher.verifyRDPS(
                    match.ranking.report.code,
                    match.ranking.report.fightID,
                    api
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
                        matchedFight
                    };
                }
            }
        }
    }

    return { allMatches, allRankingsData, matchedFight };
}

/**
 * 검색 중단 처리
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @param {FFLogsAPI} api - API 인스턴스
 */
export async function handleSearchAbort(rankingCache, api) {
    if (api) {
        api.cancelAll();
    }
    await rankingCache.abortSearch();
    await updateCacheDisplay(rankingCache);
}
