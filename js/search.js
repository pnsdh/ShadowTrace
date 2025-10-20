import { SEARCH_CONSTANTS } from './constants.js';
import { LogMatcher } from './matcher.js';
import { showLoading, updateCacheDisplay } from './ui.js';

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
                    console.log(`리포트에서 region ${region} 감지`);
                    return region;
                }
            }
        }
    }

    console.log('지역을 감지하지 못했습니다. 전체 지역에서 검색합니다.');
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
        console.log(`리포트에서 partition ${partition} 감지`);

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
    console.log(`기본 partition ${partition} 사용`);
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
            showLoading(`${fight.name} 전체 페이지 수 확인 중...${fightProgressText}${regionText}`);
            estimatedMaxPages = await api.findMaxPages(
                fight.encounterID,
                fight.difficulty,
                fight.size,
                region,
                partition,
                rankingCache,
                partitionName
            );
        }

        if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

        const matcher = new LogMatcher(fight, report.startTime, reportCode);

        let page = 1;
        let hasMorePages = true;
        const fightMatches = [];
        const fightRankingsData = [];

        if (hasCache) {
            showLoading(`${fight.name} 매칭 중${fightProgressText}${regionText}`);
        }

        while (hasMorePages && page <= SEARCH_CONSTANTS.MAX_PAGES) {
            if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

            // 캐시 모드에서 현재 페이지가 캐시된 최대 페이지를 초과하면 종료
            if (hasCache && cachedMaxPage && page > cachedMaxPage) {
                break;
            }

            if (!hasCache) {
                const pageText = region ? ` (${region}, ${page}/${estimatedMaxPages}, ${partitionText})` : ` (전체, ${page}/${estimatedMaxPages}, ${partitionText})`;
                const statusText = `${fight.name} 매칭 중${fightProgressText}${pageText}`;
                showLoading(statusText);
            }

            const rankings = await api.getEncounterRankings(
                fight.encounterID,
                fight.difficulty,
                fight.size,
                region,
                page,
                partition,
                rankingCache,
                hasCache ? null : async () => await updateCacheDisplay(rankingCache),
                partitionName
            );

            if (!rankings || !rankings.rankings || !Array.isArray(rankings.rankings)) {
                console.warn('유효하지 않은 랭킹 데이터:', rankings);
                break;
            }

            fightRankingsData.push(rankings);

            for (const ranking of rankings.rankings) {
                if (signal.aborted) return { allMatches, allRankingsData, matchedFight, aborted: true };

                if (!ranking || !ranking.report) {
                    console.warn('유효하지 않은 랭킹 항목:', ranking);
                    continue;
                }

                if (ranking.name === 'Anonymous' || ranking.name === 'anonymous') {
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

            hasMorePages = rankings.hasMorePages;
            page++;
        }

        // 현재 fight의 모든 페이지 검색 완료 후 매칭 성공 체크
        if (fightMatches.length > 0) {
            // RDPS 검증 수행
            showLoading(`${fight.name} 매칭 결과 검증 중...${fightProgressText}${regionText}`);

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
