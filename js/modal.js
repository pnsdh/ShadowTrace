import { updateCacheDisplay } from './ui.js';

/**
 * 모달 관리 모듈
 * 설정 모달, 캐시 관리 모달, 확인 다이얼로그 등을 관리합니다
 */

/**
 * API 설정 모달을 엽니다
 */
export function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
}

/**
 * API 설정 모달을 닫습니다
 */
export function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

/**
 * 캐시 데이터 관리 모달을 엽니다
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 */
export function openCacheModal(rankingCache) {
    document.getElementById('cacheModal').classList.add('active');
    updateCacheDisplay(rankingCache);
}

/**
 * 캐시 데이터 관리 모달을 닫습니다
 */
export function closeCacheModal() {
    document.getElementById('cacheModal').classList.remove('active');
}

/**
 * 확인/취소 다이얼로그를 표시합니다
 * @param {string} title - 다이얼로그 제목
 * @param {string} message - 다이얼로그 메시지 (HTML 지원)
 * @param {boolean} onlyConfirm - true면 확인 버튼만 표시
 * @returns {Promise<boolean>} 사용자가 확인을 누르면 true, 취소를 누르면 false
 */
export function showConfirm(title, message, onlyConfirm = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        titleEl.textContent = title;
        messageEl.innerHTML = message; // HTML 지원

        // 취소 버튼 표시/숨김
        if (onlyConfirm) {
            noBtn.style.display = 'none';
        } else {
            noBtn.style.display = 'block';
        }

        modal.classList.add('active');

        const handleYes = () => {
            modal.classList.remove('active');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            resolve(true);
        };

        const handleNo = () => {
            modal.classList.remove('active');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            resolve(false);
        };

        yesBtn.addEventListener('click', handleYes);
        noBtn.addEventListener('click', handleNo);
    });
}

/**
 * 모달 외부 클릭 시 모달을 닫는 이벤트 핸들러를 등록합니다
 */
export function setupModalClickOutside() {
    window.onclick = function(event) {
        const settingsModal = document.getElementById('settingsModal');
        const cacheModal = document.getElementById('cacheModal');
        const confirmModal = document.getElementById('confirmModal');

        if (event.target === settingsModal) {
            closeSettingsModal();
        }
        if (event.target === cacheModal) {
            closeCacheModal();
        }
        if (event.target === confirmModal) {
            confirmModal.classList.remove('active');
        }
    };
}
