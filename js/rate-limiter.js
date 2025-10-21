/**
 * FFLogs API Rate Limiter
 * 시간 윈도우 기반 요청 추적 및 관리 (설정: RATE_LIMIT_CONSTANTS)
 */

import { RATE_LIMIT_CONSTANTS } from './constants.js';

export class RateLimiter {
    // 모든 인스턴스가 공유하는 요청 기록 (static)
    static requestHistory = RateLimiter.loadRequestHistory(); // { timestamp, count }

    /**
     * localStorage에서 요청 기록 복원
     */
    static loadRequestHistory() {
        try {
            const saved = localStorage.getItem('fflogs_request_history');
            if (saved) {
                const history = JSON.parse(saved);
                // 윈도우 시간 이내 기록만 유효
                const cutoff = Date.now() - RATE_LIMIT_CONSTANTS.WINDOW_MS;
                return history.filter(r => r.timestamp > cutoff);
            }
        } catch (e) {
            console.warn('요청 기록 복원 실패:', e);
        }
        return [];
    }

    /**
     * localStorage에 요청 기록 저장
     */
    static saveRequestHistory() {
        try {
            localStorage.setItem('fflogs_request_history', JSON.stringify(RateLimiter.requestHistory));
        } catch (e) {
            console.warn('요청 기록 저장 실패:', e);
        }
    }

    /**
     * 최근 윈도우 시간 동안의 요청 수 반환 (오래된 기록 자동 필터링)
     */
    static getRecentRequestCount() {
        const now = Date.now();
        const cutoff = now - RATE_LIMIT_CONSTANTS.WINDOW_MS;
        const beforeLen = RateLimiter.requestHistory.length;
        RateLimiter.requestHistory = RateLimiter.requestHistory.filter(r => r.timestamp > cutoff);
        const afterLen = RateLimiter.requestHistory.length;

        if (beforeLen !== afterLen) {
            console.log(`[필터링] ${beforeLen} -> ${afterLen}, cutoff=${new Date(cutoff).toISOString()}`);
            RateLimiter.saveRequestHistory(); // 필터링 후 저장
        }

        return RateLimiter.requestHistory.reduce((sum, r) => sum + r.count, 0);
    }

    /**
     * 요청 기록 추가
     * @param {number} count - 요청 수 (배치의 경우 페이지 수)
     */
    static addRequestRecord(count) {
        RateLimiter.requestHistory.push({
            timestamp: Date.now(),
            count: count
        });
        RateLimiter.saveRequestHistory();
    }

    /**
     * 현재 사용 가능한 요청 슬롯 수
     * @returns {number} 사용 가능한 슬롯 수
     */
    static getAvailableRequestSlots() {
        return Math.max(0, RATE_LIMIT_CONSTANTS.MAX_REQUESTS - RateLimiter.getRecentRequestCount());
    }

    /**
     * 필요한 슬롯만큼 확보되기까지 대기 시간 계산
     * @param {number} neededSlots - 필요한 슬롯 수
     * @returns {number} 대기 시간 (밀리초, +1초 여유 포함)
     */
    static getWaitTimeForSlots(neededSlots = 1) {
        if (RateLimiter.requestHistory.length === 0) return 0;

        const now = Date.now();

        // 현재 사용 가능한 슬롯
        const currentAvailable = RateLimiter.getAvailableRequestSlots();

        // 이미 충분하면 대기 불필요
        if (currentAvailable >= neededSlots) return 0;

        // 필요한 추가 슬롯 = 요청하려는 양 - 현재 사용 가능
        const needToFree = neededSlots - currentAvailable;

        // 오래된 것부터 누적해서 needToFree만큼 확보되는 시점 찾기
        let freedCount = 0;
        let targetTimestamp = null;

        for (const record of RateLimiter.requestHistory) {
            freedCount += record.count;
            if (freedCount >= needToFree) {
                targetTimestamp = record.timestamp;
                break;
            }
        }

        // 찾지 못한 경우 (이론상 발생하면 안 됨)
        if (!targetTimestamp) {
            const oldestRequest = RateLimiter.requestHistory[0];
            return Math.max(0, RATE_LIMIT_CONSTANTS.WINDOW_MS - (now - oldestRequest.timestamp)) + RATE_LIMIT_CONSTANTS.SAFETY_MARGIN_MS;
        }

        // 해당 기록이 만료될 때까지 대기 + 안전 여유
        const elapsed = now - targetTimestamp;
        return Math.max(0, RATE_LIMIT_CONSTANTS.WINDOW_MS - elapsed) + RATE_LIMIT_CONSTANTS.SAFETY_MARGIN_MS;
    }
}
