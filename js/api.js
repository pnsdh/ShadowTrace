import { SEARCH_CONSTANTS } from './constants.js';

// ===== FFLogs API =====
export class FFLogsAPI {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.accessToken = null;
        this.apiCallCount = 0;

        // Rate limit 정보 (GraphQL rateLimitData에서만 받음)
        this.rateLimitPerHour = null;
        this.pointsSpent = null;
        this.pointsResetIn = null;
    }

    async getAccessToken() {
        if (this.accessToken) return this.accessToken;

        const response = await fetch('https://www.fflogs.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`)
            },
            body: 'grant_type=client_credentials'
        });

        if (!response.ok) {
            throw new Error('API 인증 실패. Client ID와 Secret을 확인하세요.');
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        return this.accessToken;
    }

    async query(graphqlQuery, variables = {}) {
        const token = await this.getAccessToken();

        const response = await fetch('https://www.fflogs.com/api/v2/client', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables: variables
            })
        });

        if (!response.ok) {
            throw new Error('API 요청 실패');
        }

        // API 호출 횟수만 카운트 (사용량은 GraphQL rateLimitData에서 받음)
        this.apiCallCount++;

        const data = await response.json();
        if (data.errors) {
            throw new Error(data.errors[0].message);
        }

        return data.data;
    }

    updateApiUsageDisplay() {
        const usageEl = document.getElementById('apiUsage');
        if (usageEl) {
            let html = `📊 API 호출: ${this.apiCallCount}회`;

            if (this.rateLimitPerHour !== null && this.pointsSpent !== null) {
                const percentage = ((this.pointsSpent / this.rateLimitPerHour) * 100).toFixed(1);
                html += ` | 포인트: ${this.pointsSpent} / ${this.rateLimitPerHour} (${percentage}% 사용)`;

                if (this.pointsResetIn) {
                    const resetMinutes = Math.ceil(this.pointsResetIn / 60);
                    html += ` | ${resetMinutes}분 후 리셋`;
                }
            }

            usageEl.textContent = html;
            usageEl.style.display = 'block';
        }
    }

    resetUsageTracking() {
        this.apiCallCount = 0;
        this.rateLimitPerHour = null;
        this.pointsSpent = null;
        this.pointsResetIn = null;
        const usageEl = document.getElementById('apiUsage');
        if (usageEl) {
            usageEl.style.display = 'none';
        }
    }

    async getAnonymousReport(code) {
        const query = `
            query($code: String!) {
                reportData {
                    report(code: $code) {
                        startTime
                        endTime
                        zone {
                            id
                            name
                            partitions {
                                id
                                name
                                compactName
                                default
                            }
                        }
                        fights {
                            id
                            encounterID
                            name
                            startTime
                            endTime
                            difficulty
                            size
                            kill
                            fightPercentage
                            friendlyPlayers
                        }
                        masterData {
                            actors(type: "Player") {
                                id
                                name
                                server
                                type
                                subType
                            }
                        }
                        rankings
                    }
                }
                rateLimitData {
                    limitPerHour
                    pointsSpentThisHour
                    pointsResetIn
                }
            }
        `;

        const data = await this.query(query, { code });

        // Rate limit 정보 업데이트
        if (data.rateLimitData) {
            this.updateRateLimitInfo(data.rateLimitData);
        }

        return data.reportData.report;
    }

    async getEncounterPartitions(encounterId) {
        const query = `
            query($encounterId: Int!) {
                worldData {
                    encounter(id: $encounterId) {
                        id
                        name
                        zone {
                            partitions {
                                id
                                name
                                compactName
                                default
                            }
                        }
                    }
                }
            }
        `;

        const data = await this.query(query, { encounterId });
        return data.worldData.encounter;
    }

    async getReportPlayers(reportCode, fightID) {
        const basicQuery = `
            query($code: String!) {
                reportData {
                    report(code: $code) {
                        fights(fightIDs: [${fightID}]) {
                            id
                            friendlyPlayers
                        }
                        masterData {
                            actors(type: "Player") {
                                id
                                name
                                server
                                type
                                subType
                            }
                        }
                    }
                }
            }
        `;

        const basicData = await this.query(basicQuery, { code: reportCode });

        // 해당 fight 참여 플레이어 ID 목록
        const fight = basicData.reportData.report.fights?.[0];
        const friendlyPlayerIds = fight?.friendlyPlayers || [];

        // 전체 플레이어 중 해당 fight 참여자만 필터링
        const allActors = basicData.reportData.report.masterData?.actors || [];
        const players = allActors.filter(actor => friendlyPlayerIds.includes(actor.id));

        return { masterData: { actors: players } };
    }

    async getReportRDPS(reportCode, fightID) {
        const query = `
            query($code: String!) {
                reportData {
                    report(code: $code) {
                        table(fightIDs: [${fightID}], dataType: DamageDone)
                    }
                }
            }
        `;

        const data = await this.query(query, { code: reportCode });
        const tableData = data.reportData.report.table;

        // table 데이터에서 RDPS 추출
        if (tableData && tableData.data && tableData.data.entries) {
            return tableData.data.entries.map(entry => ({
                name: entry.name,
                amount: entry.total || 0
            }));
        }

        return [];
    }

    updateRateLimitInfo(rateLimitData) {
        this.rateLimitPerHour = rateLimitData.limitPerHour;
        this.pointsSpent = rateLimitData.pointsSpentThisHour;
        this.pointsResetIn = rateLimitData.pointsResetIn;
        this.updateApiUsageDisplay();
    }

    async getEncounterRankings(encounterId, difficulty, size, region, page = 1, partition, rankingCache, updateCacheDisplay, partitionName = null) {
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

        const data = await this.query(query);

        // Rate limit 정보 업데이트
        if (data.rateLimitData) {
            this.updateRateLimitInfo(data.rateLimitData);
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

    // 이진 탐색으로 최대 페이지 수 찾기
    async findMaxPages(encounterId, difficulty, size, region, partition, rankingCache, partitionName = null) {
        let low = 1;
        let high = SEARCH_CONSTANTS.MAX_PAGES;
        let maxValidPage = 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);

            try {
                const rankings = await this.getEncounterRankings(
                    encounterId, difficulty, size, region, mid, partition,
                    rankingCache, () => {}, partitionName // 빈 콜백, partitionName 전달
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
}
