import { SEARCH_CONSTANTS } from './constants.js';

/**
 * FFLogs Encounter Rankings 조회 모듈
 * 배치 조회, 단일 페이지 조회, 최대 페이지 탐색 등을 담당합니다
 */

/**
 * 여러 페이지의 랭킹 데이터를 배치로 조회합니다
 */
export async function getEncounterRankingsBatch(encounterQuery, startPage, pageCount, context, updateCacheDisplay) {
    const { encounterId, difficulty, size, region, partition, partitionName } = encounterQuery;
    const { api, rankingCache } = context;

    const regionFilter = region ? `, serverRegion: "${region}"` : '';
    const partitionFilter = partition ? `, partition: ${partition}` : '';

    // 캐시된 페이지와 캐시되지 않은 페이지 분리
    const pages = [];
    const cachedResults = [];

    for (let i = 0; i < pageCount; i++) {
        const page = startPage + i;
        const cached = await rankingCache.get(encounterId, difficulty, size, region, page, partition);
        if (cached) {
            cachedResults.push({ page, data: cached.data });
        } else {
            pages.push(page);
        }
    }

    // 모두 캐시되어 있으면 바로 반환
    if (pages.length === 0) {
        return cachedResults.map(r => r.data);
    }

    // 각 페이지별로 alias 생성
    const pageQueries = pages.map(page => `
        page${page}: encounter(id: ${encounterId}) {
            name
            characterRankings(
                difficulty: ${difficulty}
                metric: rdps
                size: ${size}
                page: ${page}
                ${regionFilter}
                ${partitionFilter}
            )
        }
    `).join('\n');

    const query = `
        query {
            worldData {
                ${pageQueries}
            }
            rateLimitData {
                limitPerHour
                pointsSpentThisHour
                pointsResetIn
            }
        }
    `;

    let data;
    try {
        // pageCount를 기록 (캐시 포함한 전체 페이지 수)
        data = await api.query(query, {}, pageCount);
    } catch (error) {
        console.error(`[배치 요청 실패] ${pages.length}페이지 (${pages[0]}-${pages[pages.length-1]}) - 에러:`, error.message);
        throw error;
    }

    // Rate limit 정보 업데이트
    if (data.rateLimitData) {
        api.updateRateLimitInfo(data.rateLimitData);
    }

    // 페이지별 결과 파싱 및 캐시 저장
    const results = [];
    for (const page of pages) {
        const pageData = data.worldData[`page${page}`];
        if (pageData && pageData.characterRankings) {
            const rankings = pageData.characterRankings;
            const rankingsWithName = {
                ...rankings,
                encounterName: pageData.name,
                partitionName: partitionName
            };

            await rankingCache.set(encounterId, difficulty, size, region, page, partition, rankingsWithName, pageData.name);
            results.push({ page, data: rankings });
        }
    }

    if (updateCacheDisplay) {
        await updateCacheDisplay();
    }

    // 캐시된 결과와 새로 받은 결과 합치기 (페이지 순서대로 정렬)
    const allResults = [...cachedResults, ...results].sort((a, b) => a.page - b.page);
    return allResults.map(r => r.data);
}

/**
 * 단일 페이지의 랭킹 데이터를 조회합니다
 */
export async function getEncounterRankings(encounterQuery, page = 1, context, updateCacheDisplay) {
    const { encounterId, difficulty, size, region, partition, partitionName } = encounterQuery;
    const { api, rankingCache } = context;

    // 캐시 확인 (partition 포함)
    const cached = await rankingCache.get(encounterId, difficulty, size, region, page, partition);
    if (cached) {
        return cached.data;
    }

    const regionFilter = region ? `, serverRegion: "${region}"` : '';
    const partitionFilter = partition ? `, partition: ${partition}` : '';

    const query = `
        query {
            worldData {
                encounter(id: ${encounterId}) {
                    name
                    characterRankings(
                        difficulty: ${difficulty}
                        metric: rdps
                        size: ${size}
                        page: ${page}
                        ${regionFilter}
                        ${partitionFilter}
                    )
                }
            }
            rateLimitData {
                limitPerHour
                pointsSpentThisHour
                pointsResetIn
            }
        }
    `;

    const data = await api.query(query, {}, 1);

    // Rate limit 정보 업데이트
    if (data.rateLimitData) {
        api.updateRateLimitInfo(data.rateLimitData);
    }

    const encounterData = data.worldData.encounter;
    const rankings = encounterData.characterRankings;

    // encounterName과 partitionName을 포함하도록 수정
    const rankingsWithName = {
        ...rankings,
        encounterName: encounterData.name,
        partitionName: partitionName  // 파티션 이름 추가
    };

    // 캐시에 저장 (최소화된 데이터만, partition 포함)
    await rankingCache.set(encounterId, difficulty, size, region, page, partition, rankingsWithName, encounterData.name);
    if (updateCacheDisplay) {
        await updateCacheDisplay();
    }

    return rankings;
}

/**
 * 이진 탐색으로 최대 페이지 수를 찾습니다
 */
export async function findMaxPages(encounterQuery, context) {
    let low = 1;
    let high = SEARCH_CONSTANTS.MAX_PAGES;
    let maxValidPage = 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        try {
            const rankings = await getEncounterRankings(
                encounterQuery, mid, context, () => {}
            );

            if (rankings && rankings.rankings && rankings.rankings.length > 0) {
                // 유효한 페이지 발견
                maxValidPage = mid;
                low = mid + 1;
            } else {
                // 빈 페이지 발견
                high = mid - 1;
            }
        } catch (e) {
            // 오류 발생 시 더 작은 범위로
            high = mid - 1;
        }
    }

    return maxValidPage;
}
