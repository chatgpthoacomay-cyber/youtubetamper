// ==UserScript==
// @name         YouTube AI Reply
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  AI Reply cho YouTube comment - gửi lên ChatGPT, tự động điền reply (Hỗ trợ cả YT thường và YT Studio)
// @author       You
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://studio.youtube.com/*
// @icon         https://www.google.com/s2/favicons?domain=youtube.com
// @updateURL    https://raw.githubusercontent.com/chatgpthoacomay-cyber/youtubetamper/main/youtube-tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/chatgpthoacomay-cyber/youtubetamper/main/youtube-tampermonkey.user.js
// @supportURL   https://github.com/chatgpthoacomay-cyber/youtubetamper/issues
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // ==================== CONFIG ====================
    const API_CONFIG = {
        url: 'https://ds2api-two.vercel.app/v1/chat/completions',
        key: 'sk-c1c25af22fa2444eb5fcc9154d97bd3b',
        model: 'deepseek-v4-flash-nothinking'
    };

    const SYSTEM_PROMPT = `Bạn là một trợ lý ảo chuyên trả lời comment trên YouTube. Hãy đọc comment của người dùng và tạo ra câu trả lời dựa trên các quy tắc sau:

1. Reply phải ngắn gọn (1 câu là đủ, tối đa 2 câu).
2. Luôn trả lời bằng ĐÚNG ngôn ngữ của comment gốc. Ví dụ: comment tiếng Đức thì trả lời tiếng Đức, comment tiếng Pháp thì trả lời tiếng Pháp, comment tiếng Anh thì trả lời tiếng Anh, comment tiếng Việt thì trả lời tiếng Việt...
3. Không tranh cãi với người xem, kể cả khi họ chê bai.
- Nếu comment tích cực: "Thank you, I appreciate it.", "Thank you, that means a lot.", "Glad you enjoyed it.", "Thanks for watching."
- Nếu comment góp ý logic/story thì nhận góp ý nhẹ nhàng: "That's fair—the timeline could've been clearer.", "I understand the confusion.", "That part could've been explained more clearly."
- Nếu comment đưa quan điểm cá nhân, không khẳng định đúng sai: "That's a fair point.", "I can see why you feel that way.", "That's an interesting perspective."
- Nếu comment chỉ ghi địa điểm: "Thanks for watching from...", "Sending love to...", "Greetings to..."
4. Nội dung reply tùy chỉnh linh hoạt theo ngữ cảnh, không gò bó theo mẫu cố định.

QUAN TRỌNG: Bạn PHẢI trả về kết quả dưới dạng JSON chuẩn. KHÔNG ĐƯỢC sinh ra bất kỳ văn bản nào khác ngoài JSON.
Cấu trúc JSON bắt buộc phải có 2 trường (key) sau:
{
  "reply_original": "[Câu reply của bạn bằng ĐÚNG ngôn ngữ của comment gốc]",
  "reply_vietnamese": "[Bản dịch câu reply đó sang tiếng Việt]"
}`;

    // ==================== HELPERS ====================
    function waitForElementInContainer(container, selector, timeout = 5000) {
        return new Promise((resolve) => {
            const el = container.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
                const found = container.querySelector(selector);
                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(container, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ==================== JSON EXTRACTOR ====================
    function extractJSON(str) {
        if (!str) return null;

        // Thử parse trực tiếp
        try {
            return JSON.parse(str);
        } catch (e) {}

        // Tìm object JSON hợp lệ bằng bracket counting
        let depth = 0;
        let start = -1;
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (ch === '{') {
                if (start === -1) start = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && start !== -1) {
                    const jsonStr = str.substring(start, i + 1);
                    try {
                        return JSON.parse(jsonStr);
                    } catch (e) {
                        start = -1; // Reset, tìm object tiếp theo
                    }
                }
            }
        }
        return null;
    }

    // ==================== AI CALL ====================
    function callAI(commentText) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: API_CONFIG.url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_CONFIG.key}`
                },
                data: JSON.stringify({
                    model: API_CONFIG.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: commentText }
                    ]
                }),
                onload: function(res) {
                    try {
                        // Parse HTTP response body (có thể có text dư sau JSON)
                        let responseData;
                        try {
                            responseData = JSON.parse(res.responseText);
                        } catch (e) {
                            // Nếu parse trực tiếp fail, thử extract JSON từ responseText
                            const extracted = extractJSON(res.responseText);
                            if (extracted) {
                                responseData = extracted;
                            } else {
                                console.error('Raw HTTP response:', res.responseText?.substring(0, 500));
                                reject(new Error('Cannot parse API response'));
                                return;
                            }
                        }

                        let content = responseData.choices?.[0]?.message?.content;
                        if (!content) {
                            reject(new Error('Empty response from AI'));
                            return;
                        }

                        // Remove markdown code blocks
                        content = content.replace(/```(?:json)?\s*\n?/gi, '').replace(/\n?```/g, '').trim();

                        // Parse content (AI's reply_original + reply_vietnamese JSON)
                        const parsed = extractJSON(content);
                        if (parsed) {
                            resolve(parsed);
                        } else {
                            console.error('Raw AI response content:', content?.substring(0, 500));
                            reject(new Error('Cannot parse AI response as JSON'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: function(err) {
                    reject(new Error('Request failed'));
                }
            });
        });
    }

    // ==================== FIND YOUTUBE REPLY BUTTON ====================
    function findNativeReplyBtn(commentThread) {
        const comment = commentThread.querySelector('#comment') || commentThread;
        const actionMenu = comment.querySelector('#action-menu') || comment;

        // Thử nhiều selector để tìm nút reply gốc của YouTube (cả YT thường và Studio)
        const selectors = [
            // YT Studio selectors
            'ytcp-comment-button#reply-button button',
            'ytcp-comment-button#reply-button',
            '#reply-button button',
            'ytcp-comment-button button[aria-label="Reply"]',
            // YT thường selectors
            '#action-menu [aria-label="Reply"]',
            '#toolbar [aria-label="Reply"]',
            '#action-menu a[aria-label="Reply"]',
            '#action-menu button[aria-label="Reply"]',
            '#action-menu tp-yt-paper-button[aria-label="Reply"]',
            // Fallback: tìm button/text chứa "Reply"
            '#action-menu .yt-simple-endpoint[aria-label="Reply"]',
            '#action-menu a:has(div.ytSpecTouchFeedbackShapeFill)',
        ];

        for (const sel of selectors) {
            try {
                const btn = commentThread.querySelector(sel);
                if (btn) return btn;
            } catch(e) {}
        }

        // Fallback: duyệt manual qua các button trong action-menu
        const allBtns = commentThread.querySelectorAll('#action-menu button, #action-menu a, #action-menu tp-yt-paper-button');
        for (const btn of allBtns) {
            const text = btn.textContent?.trim().toLowerCase();
            const label = btn.getAttribute('aria-label')?.toLowerCase();
            if (text === 'reply' || label === 'reply') {
                return btn;
            }
        }

        return null;
    }

    // ==================== MAIN HANDLER ====================
    async function handleReply(commentThread, customBtn) {
        try {
            customBtn.textContent = '⏳';
            customBtn.disabled = true;

            // 1. Click nút reply gốc của YouTube
            const nativeBtn = findNativeReplyBtn(commentThread);
            if (!nativeBtn) {
                console.log('❌ Không tìm thấy nút Reply gốc');
                customBtn.textContent = '✕';
                setTimeout(() => { customBtn.textContent = 'AI'; customBtn.disabled = false; }, 2000);
                return;
            }
            nativeBtn.click();

            // 2. Đợi reply box mở (YT thường dùng #contenteditable-root, Studio dùng textarea)
            const isStudio = window.location.hostname === 'studio.youtube.com';
            let replyRoot;
            if (isStudio) {
                // Studio: đợi reply-dialog-container xuất hiện, rồi tìm textarea bên trong
                await waitForElementInContainer(commentThread, '#reply-dialog-container', 3000);
                replyRoot = await waitForElementInContainer(commentThread, 'ytcp-commentbox textarea#textarea', 5000);
            } else {
                replyRoot = await waitForElementInContainer(commentThread, '#contenteditable-root', 5000);
            }
            if (!replyRoot) {
                console.log('❌ Không tìm thấy reply box');
                customBtn.textContent = 'AI';
                customBtn.disabled = false;
                return;
            }

            await sleep(500);

            // 3. Lấy nội dung comment (Studio dùng #comment-content hoặc fallback)
            let commentText;
            if (isStudio) {
                commentText = commentThread.querySelector('yt-formatted-string#content-text')?.textContent?.trim()
                    || commentThread.querySelector('#comment-content')?.textContent?.trim()
                    || commentThread.querySelector('[slot="content"]')?.textContent?.trim();
            } else {
                commentText = commentThread.querySelector('#content-text')?.textContent?.trim();
            }
            if (!commentText) {
                console.log('❌ Không tìm thấy nội dung comment');
                customBtn.textContent = 'AI';
                customBtn.disabled = false;
                return;
            }

            console.log('💬 Comment:', commentText);
            customBtn.textContent = '🤖';

            // 4. Gọi AI
            const result = await callAI(commentText);
            console.log('✅ AI Reply:', result);

            // 5. Điền reply_original vào ô reply
            if (result.reply_original) {
                if (isStudio) {
                    replyRoot.value = result.reply_original;
                    replyRoot.dispatchEvent(new Event('input', { bubbles: true }));
                    replyRoot.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    replyRoot.textContent = result.reply_original;
                    replyRoot.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
                    replyRoot.dispatchEvent(new Event('input', { bubbles: true }));
                    replyRoot.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // 6. Hiển thị reply_vietnamese
            if (result.reply_vietnamese) {
                showVietnameseBox(commentThread, result.reply_vietnamese);
            }

            customBtn.textContent = '✓';

        } catch (e) {
            console.error('❌ Lỗi:', e);
            customBtn.textContent = '✕';
        }

        setTimeout(() => {
            customBtn.textContent = 'AI';
            customBtn.disabled = false;
        }, 2000);
    }

    // ==================== VIETNAMESE TEXT BOX ====================
    function showVietnameseBox(commentThread, text) {
        // Xóa box cũ nếu có
        const oldBox = commentThread.querySelector('.custom-vi-reply');
        if (oldBox) oldBox.remove();

        const box = document.createElement('div');
        box.className = 'custom-vi-reply';
        box.textContent = `🇻🇳 ${text}`;
        Object.assign(box.style, {
            padding: '8px 12px',
            margin: '8px 0 4px 0',
            fontSize: '13px',
            color: '#aaa',
            background: 'rgba(62, 166, 255, 0.08)',
            borderRadius: '4px',
            borderLeft: '3px solid #3ea6ff',
            lineHeight: '1.4'
        });

        // Chèn vào sau reply box (cả YT thường và YT Studio)
        const replyBox = commentThread.querySelector('ytd-commentbox, ytd-comment-dialog-renderer, #reply-dialog-container');
        if (replyBox) {
            replyBox.after(box);
        } else {
            const footer = commentThread.querySelector('#footer');
            if (footer) footer.after(box);
        }
    }

    // ==================== ADD CUSTOM REPLY BUTTONS ====================
    function addCustomButtons() {
        try {
            const threads = document.querySelectorAll('ytd-comment-thread-renderer, ytcp-comment-thread, ytcp-comment');

            threads.forEach((thread) => {
                try {
                    // Bỏ qua nếu đã có button
                    if (thread.querySelector('.custom-reply-btn')) return;

                    const toolbar = thread.querySelector('#toolbar');
                    const actionMenu = thread.querySelector('#action-menu');

                    const btn = document.createElement('button');
                    btn.className = 'custom-reply-btn';
                    btn.textContent = 'AI';
                    Object.assign(btn.style, {
                        background: 'none',
                        border: '1px solid #3ea6ff',
                        color: '#3ea6ff',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: '600',
                        padding: '2px 10px',
                        borderRadius: '12px',
                        marginLeft: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.2s',
                        lineHeight: '20px'
                    });
                    btn.title = 'AI Reply - Tạo câu trả lời bằng AI';
                    btn.dataset.commentId = thread.id || '';

                    btn.onmouseenter = () => {
                        btn.style.background = 'rgba(62, 166, 255, 0.15)';
                        btn.style.transform = 'scale(1.05)';
                    };
                    btn.onmouseleave = () => {
                        btn.style.background = 'none';
                        btn.style.transform = 'scale(1)';
                    };

                    btn.addEventListener('click', async function(e) {
                        e.stopPropagation();
                        e.preventDefault();
                        await handleReply(thread, btn);
                    });

                    // Thêm vào toolbar (gần các nút Like/Dislike/Reply)
                    if (toolbar) {
                        toolbar.appendChild(btn);
                    } else if (actionMenu) {
                        actionMenu.appendChild(btn);
                    } else {
                        // Studio fallback: chèn cạnh nút reply
                        const replyBtn = thread.querySelector('ytcp-comment-button#reply-button');
                        if (replyBtn && replyBtn.parentElement) {
                            replyBtn.parentElement.insertBefore(btn, replyBtn);
                        }
                    }

                } catch (e) { /* skip comment */ }
            });
        } catch (e) { /* skip */ }
    }

    // ==================== STYLES ====================
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .custom-reply-btn {
                user-select: none;
                font-family: 'Roboto', Arial, sans-serif;
            }
            .custom-reply-btn:disabled {
                opacity: 0.6;
                cursor: wait;
            }
            .custom-vi-reply {
                font-family: 'Roboto', Arial, sans-serif;
                animation: customFadeIn 0.3s ease;
            }
            @keyframes customFadeIn {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== INIT ====================
    function init() {
        injectStyles();
        addCustomButtons();

        // Watch for dynamic content (SPA navigation, load more)
        const observer = new MutationObserver(() => {
            addCustomButtons();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
