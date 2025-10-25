import { SEARCH_CONSTANTS, RATE_LIMIT_CONSTANTS } from './constants.js';
import { RateLimiter } from './rate-limiter.js';
import { updateApiUsageDisplay } from './ui.js';

// ===== FFLogs API =====
export class FFLogsAPI {
    constructor(clientId, clientSecret, startPeriodicUpdate = true) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.accessToken = null;

        // Rate limit 정보 (GraphQL rateLimitData에서만 받음)
        this.rateLimitPerHour = null;
        this.pointsSpent = null;
        this.pointsResetIn = null;

        // 실시간 업데이트 관련
        this.updateInterval = null;
        this.isWaiting = false;

        // 중앙 취소 관리
        this.controller = null;

        // 주기적 업데이트 시작 (옵션)
        if (startPeriodicUpdate) {
            this.startPeriodicUpdate();
        }
    }

    cancelAll() {
        if (this.controller) {
            this.controller.abort();
            this.controller = null;
        }
    }

    _getSignal() {
        if (!this.controller) {
            this.controller = new AbortController();
        }
        return this.controller.signal;
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

    async query(graphqlQuery, variables = {}, requestCount = 1) {
        const signal = this._getSignal();

        // 포인트 체크: 예상 포인트 소모량 계산
        const estimatedPoints = requestCount * RATE_LIMIT_CONSTANTS.POINTS_PER_REQUEST;
        const availablePoints = this.getAvailablePointSlots();

        if (availablePoints !== null && availablePoints < estimatedPoints) {
            const resetMinutes = Math.ceil(this.pointsResetIn / 60);
            throw new Error(
                `포인트 부족: 약 ${estimatedPoints.toFixed(1)} 포인트 필요하지만, ` +
                `${availablePoints.toFixed(1)} 포인트만 남아있습니다. (${resetMinutes}분 후 리셋)`
            );
        }

        // Rate limit 체크: HTTP 요청은 항상 1개 슬롯만 필요 (배치 크기와 무관)
        const availableSlots = RateLimiter.getAvailableRequestSlots();
        if (availableSlots < 1) {
            const waitTime = RateLimiter.getWaitTimeForSlots(1);

            // 대기 플래그 설정 및 주기적 업데이트 중지
            this.isWaiting = true;
            this.stopPeriodicUpdate();

            // 카운트다운하면서 대기 (중단 신호 체크)
            let remainingSeconds = Math.ceil(waitTime / 1000);
            while (remainingSeconds > 0) {
                // 중단 신호 체크
                if (signal.aborted) {
                    this.isWaiting = false;
                    this.startPeriodicUpdate();
                    updateApiUsageDisplay(this);
                    throw new Error('검색이 중단되었습니다.');
                }

                updateApiUsageDisplay(this, `⏳ API 제한 대기 중... ${remainingSeconds}초`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                remainingSeconds--;
            }

            // 대기 완료 후 정상 표시로 복귀 및 주기적 업데이트 재시작
            this.isWaiting = false;
            this.startPeriodicUpdate();
            updateApiUsageDisplay(this);
        }

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
            }),
            signal
        });

        if (!response.ok) {
            throw new Error('API 요청 실패');
        }

        // Rate limit 추적: HTTP 요청은 항상 1회로 카운트 (배치 크기와 무관)
        // 장기 포인트(FFLogs rateLimitData)는 requestCount만큼 증가하지만,
        // 단기 포인트(HTTP 요청 횟수)는 항상 1씩 증가
        RateLimiter.addRequestRecord(1);

        const data = await response.json();
        if (data.errors) {
            throw new Error(data.errors[0].message);
        }

        return data.data;
    }

    // 실시간 갱신: 대기 중이 아닐 때만 업데이트
    _periodicUpdate() {
        if (!this.isWaiting) {
            updateApiUsageDisplay(this);
        }
    }

    // 주기적 업데이트 시작
    startPeriodicUpdate() {
        if (this.updateInterval) return; // 중복 방지

        this.updateInterval = setInterval(() => {
            this._periodicUpdate();
        }, 1000);
    }

    // 주기적 업데이트 중지
    stopPeriodicUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    getRecentRequestCount() {
        return RateLimiter.getRecentRequestCount();
    }

    getAvailableRequestSlots() {
        return RateLimiter.getAvailableRequestSlots();
    }

    getAvailablePointSlots() {
        if (!this.rateLimitPerHour || !this.pointsSpent) return null;
        return Math.max(0, this.rateLimitPerHour - this.pointsSpent);
    }

    getWaitTimeForSlots(neededSlots = 1) {
        return RateLimiter.getWaitTimeForSlots(neededSlots);
    }

    resetUsageTracking() {
        this.rateLimitPerHour = null;
        this.pointsSpent = null;
        this.pointsResetIn = null;
        // requestHistory는 RateLimiter에서 시간 윈도우 기반으로 자동 관리되므로 리셋하지 않음
        const usageEl = document.getElementById('apiUsage');
        if (usageEl) {
            usageEl.classList.remove('active');
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

        const data = await this.query(query, { code }, 1);

        // Rate limit 정보 업데이트
        if (data.rateLimitData) {
            this.updateRateLimitInfo(data.rateLimitData);
        }

        return data.reportData.report;
    }

    async getEncounterPartitions(encounterId) {
        const query = `
            query {
                worldData {
                    encounter(id: ${encounterId}) {
                        zone {
                            partitions {
                                id
                                compactName
                            }
                        }
                    }
                }
            }
        `;

        const data = await this.query(query, {}, 1);
        return data.worldData.encounter.zone.partitions;
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

        const basicData = await this.query(basicQuery, { code: reportCode }, 1);

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

        const data = await this.query(query, { code: reportCode }, 1);
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

        // 대기 중이 아닐 때만 업데이트 (대기 중에는 카운트다운 유지)
        if (!this.isWaiting) {
            updateApiUsageDisplay(this);
        }
    }
}

/**
 * API 사용량을 조회하여 표시합니다
 * @param {string} clientId - FFLogs API Client ID
 * @param {string} clientSecret - FFLogs API Client Secret
 * @param {FFLogsAPI} existingApiInstance - 기존 API 인스턴스 (재사용)
 */
export async function loadApiUsage(clientId, clientSecret, existingApiInstance = null) {
    try {
        const api = existingApiInstance;

        if (!api) {
            console.warn('loadApiUsage: API 인스턴스가 제공되지 않았습니다.');
            return;
        }

        // 간단한 쿼리로 rateLimitData만 가져오기
        const query = `
            query {
                rateLimitData {
                    limitPerHour
                    pointsSpentThisHour
                    pointsResetIn
                }
            }
        `;

        const data = await api.query(query);

        if (data.rateLimitData) {
            api.updateRateLimitInfo(data.rateLimitData);
        }
    } catch (e) {
        // API 키가 잘못되었거나 네트워크 오류 시 조용히 무시
        console.warn('API 사용량 조회 실패:', e);
    }
}
