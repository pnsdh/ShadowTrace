import { updateCacheDisplay } from './ui.js';

/**
 * 모달 관리 모듈
 * 설정 모달, 캐시 관리 모달, 확인 다이얼로그 등을 관리합니다
 */

/**
 * 현재 열려있는 모달이 있는지 확인합니다
 * @returns {boolean} 모달이 하나라도 열려있으면 true
 */
export function isAnyModalOpen() {
    const modals = document.querySelectorAll('.modal');
    return Array.from(modals).some(modal => modal.classList.contains('active'));
}

/**
 * API 설정 모달을 엽니다
 */
export function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('active');

    // 기존 이벤트 리스너 제거 (중복 방지)
    if (modal._cleanupSettingsEnter) {
        modal._cleanupSettingsEnter();
    }

    // 엔터 키로 저장
    const handleEnter = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // 같은 요소의 다른 리스너도 막기
            window.saveSettings();
        }
    };

    // 모달이 닫힐 때 이벤트 제거
    const cleanup = () => {
        document.removeEventListener('keypress', handleEnter, true);
        modal.removeEventListener('modal-closed', cleanup);
    };

    // 캡처 단계에서 이벤트 먼저 잡기
    document.addEventListener('keypress', handleEnter, true);
    modal.addEventListener('modal-closed', cleanup);
    modal._cleanupSettingsEnter = cleanup; // cleanup 참조 저장
}

/**
 * API 설정 모달을 닫습니다
 */
export function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');

    // 엔터 키 이벤트 정리
    if (modal._cleanupSettingsEnter) {
        modal._cleanupSettingsEnter();
        modal._cleanupSettingsEnter = null;
    }
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

        // 기존 이벤트 정리 (중복 방지)
        if (modal._cleanupConfirm) {
            modal._cleanupConfirm();
        }

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
            cleanup();
            resolve(true);
        };

        const handleNo = () => {
            cleanup();
            resolve(false);
        };

        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation(); // 같은 요소의 다른 리스너도 막기
                handleYes();
            }
        };

        const cleanup = () => {
            modal.classList.remove('active');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            document.removeEventListener('keypress', handleEnter, true);
            modal._cleanupConfirm = null;
        };

        yesBtn.addEventListener('click', handleYes);
        noBtn.addEventListener('click', handleNo);
        // 캡처 단계에서 이벤트 먼저 잡기
        document.addEventListener('keypress', handleEnter, true);
        modal._cleanupConfirm = cleanup; // cleanup 참조 저장
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
