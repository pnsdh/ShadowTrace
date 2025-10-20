import { STORAGE_KEYS } from './constants.js';
import { FFLogsAPI } from './api.js';
import { showError } from './ui.js';
import { closeSettingsModal } from './modal.js';

/**
 * 설정 관리 모듈
 * API 키 저장, 로드, 사용량 조회 등을 담당합니다
 */

/**
 * API 설정을 저장합니다
 */
export function saveSettings() {
    const clientId = document.getElementById('clientId').value.trim();
    const clientSecret = document.getElementById('clientSecret').value.trim();

    if (!clientId || !clientSecret) {
        showError('Client ID와 Client Secret을 모두 입력하세요.');
        return;
    }

    saveApiKeys();
    closeSettingsModal();
    showError('설정이 저장되었습니다. ✅');
}

/**
 * API 키를 localStorage에 저장합니다
 */
export function saveApiKeys() {
    const clientId = document.getElementById('clientId').value.trim();
    const clientSecret = document.getElementById('clientSecret').value.trim();

    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId);
    localStorage.setItem(STORAGE_KEYS.CLIENT_SECRET, clientSecret);
}

/**
 * 저장된 API 키를 로드하여 입력 필드에 표시합니다
 */
export function loadSavedApiKeys() {
    const savedClientId = localStorage.getItem(STORAGE_KEYS.CLIENT_ID);
    const savedClientSecret = localStorage.getItem(STORAGE_KEYS.CLIENT_SECRET);

    if (savedClientId) document.getElementById('clientId').value = savedClientId;
    if (savedClientSecret) document.getElementById('clientSecret').value = savedClientSecret;

    return { savedClientId, savedClientSecret };
}

/**
 * API 사용량을 조회하여 표시합니다
 * @param {string} clientId - FFLogs API Client ID
 * @param {string} clientSecret - FFLogs API Client Secret
 */
export async function loadApiUsage(clientId, clientSecret) {
    try {
        const api = new FFLogsAPI(clientId, clientSecret);

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
