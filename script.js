document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const viewCompleteDialogBtn = document.getElementById('viewCompleteDialogBtn');
    const exportHtmlBtn = document.getElementById('exportHtmlBtn');
    const searchPromptsInput = document.getElementById('searchPrompts');
    const copyConfirmationPopup = document.getElementById('copy-confirmation');

    let parsedData = null;
    let currentPrompts = [];

    marked.setOptions({
        highlight: function(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            // console.log(`Highlighting: lang=${lang}, resolved_lang=${language}`);
            try {
                return hljs.highlight(code, { language, ignoreIllegals: true }).value;
            } catch (e) {
                // console.error("Highlighting error:", e, "Lang:", language, "Code:", code.substring(0,100));
                return hljs.highlight(code, { language: 'plaintext', ignoreIllegals: true }).value; // Fallback
            }
        },
        pedantic: false,
        gfm: true,
        breaks: false,
        sanitize: false,
        smartLists: true,
        smartypants: false,
        xhtml: false
    });

    // Initialize with the first tab open
    const firstTabButton = document.querySelector('#details-tabs .tab-link');
    if (firstTabButton) {
        openTab(null, firstTabButton.dataset.tab, firstTabButton);

        // Initialize visibility and button text for ALL metadata sections
        document.querySelectorAll('.toggle-visibility-btn').forEach(btn => {
            const targetId = btn.dataset.target;
            const contentElement = document.getElementById(targetId);
            if (contentElement) {
                // Check the 'initially-hidden' class first, then the actual display style
                const isInitiallyHiddenByClass = contentElement.classList.contains('initially-hidden');
                const isHiddenByStyle = contentElement.style.display === 'none';

                if (isInitiallyHiddenByClass) {
                    contentElement.style.display = 'none'; // Ensure JS respects the initial class if not already set by style
                    btn.textContent = '[Show]';
                } else if (isHiddenByStyle) {
                     btn.textContent = '[Show]';
                }
                else {
                    // If it's not hidden by class or style (meaning it's visible)
                    btn.textContent = '[Hide]';
                }
            }
        });
    }

    fileInput.addEventListener('change', handleFileLoad);
    viewCompleteDialogBtn.addEventListener('click', () => {
        if (parsedData) {
            displayCompleteDialog();
        } else {
            alert("Please load a file first.");
        }
    });

    exportHtmlBtn.addEventListener('click', () => {
        if (parsedData) {
            exportConversationToHtml();
        } else {
            alert("Please load a file first to export.");
        }
    });

    searchPromptsInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const promptItems = document.querySelectorAll('#prompt-list .prompt-item');
        promptItems.forEach(item => {
            const itemText = item.getAttribute('data-full-text') ? item.getAttribute('data-full-text').toLowerCase() : item.textContent.toLowerCase();
            if (itemText.includes(searchTerm)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    });

    document.querySelectorAll('#details-tabs .tab-link').forEach(button => {
        button.addEventListener('click', (event) => {
            openTab(event, button.dataset.tab, button);
        });
    });

    document.getElementById('details-section').addEventListener('click', function(event) {
        if (event.target.classList.contains('toggle-visibility-btn')) {
            const targetId = event.target.dataset.target;
            const contentElement = document.getElementById(targetId);
            if (contentElement) {
                const isHidden = contentElement.style.display === 'none' || contentElement.classList.contains('initially-hidden');
                contentElement.style.display = isHidden ? 'block' : 'none';
                contentElement.classList.remove('initially-hidden');
                event.target.textContent = isHidden ? '[Hide]' : '[Show]';
            }
        }
    });

    document.getElementById('answer-view').addEventListener('click', function(event) {
        if (event.target.classList.contains('copy-code-btn')) {
            const preElement = event.target.closest('pre');
            if (preElement) {
                const codeElement = preElement.querySelector('code');
                const codeToCopy = codeElement ? codeElement.innerText : preElement.innerText; // Prefer code tag's text
                navigator.clipboard.writeText(codeToCopy).then(() => {
                    showCopyConfirmation();
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    alert('Failed to copy code.');
                });
            }
        }
        const collapsibleHeader = event.target.closest('.collapsible-header');
        if (collapsibleHeader) { // Check if the click was on or within a header
            const messageDiv = collapsibleHeader.closest('.message');
            if (messageDiv) {
                toggleCollapsibleMessage(messageDiv);
            }
        }
    });

    function handleFileLoad(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    parsedData = JSON.parse(e.target.result);
                    processLlmOutput();
                } catch (error) {
                    console.error("Error parsing JSON:", error);
                    document.getElementById('answer-view').innerHTML = `<p class="placeholder error">Error parsing file. Please ensure it's valid JSON.</p>`;
                    alert("Invalid JSON file. Check console for details.");
                }
            };
            reader.readAsText(file);
        }
    }

    function processLlmOutput() {
        if (!parsedData) return;

        displayRunDetails(parsedData.runSettings);
        displayCitations(parsedData.citations);
        displaySystemInstruction(parsedData.systemInstruction);

        currentPrompts = [];
        const allChunks = parsedData.chunkedPrompt?.chunks || [];
        let i = 0; // Use a while loop for more control over the index

        while (i < allChunks.length) {
            const chunk = allChunks[i];

            if (chunk.role !== 'user') {
                i++;
                continue; // Skip non-user chunks in the main loop
            }

            // Case 1: This is a normal text chunk that is NOT preceded by file uploads.
            if (chunk.text) {
                currentPrompts.push({
                    role: 'user',
                    text: chunk.text,
                    displayText: chunk.text, // For text chunks, display text is the same
                    tokenCount: chunk.tokenCount,
                    originalIndexInChunks: i
                });
                i++;
                continue;
            }

            // Case 2: This is the start of one or more file upload chunks.
            if (chunk.driveDocument) {
                const fileChunks = [];
                // Step A: Collect all consecutive file uploads starting from here.
                let fileScanIndex = i;
                while (fileScanIndex < allChunks.length && allChunks[fileScanIndex].driveDocument && allChunks[fileScanIndex].role === 'user') {
                    fileChunks.push({ ...allChunks[fileScanIndex], originalIndexInChunks: fileScanIndex });
                    fileScanIndex++;
                }

                // Step B: Now, scan forward to find the very next text chunk.
                let textChunk = null;
                let textScanIndex = fileScanIndex;
                while (textScanIndex < allChunks.length) {
                    if (allChunks[textScanIndex].role === 'user' && allChunks[textScanIndex].text) {
                        textChunk = allChunks[textScanIndex];
                        break;
                    }
                    textScanIndex++;
                }

                // Step C: Extract filenames from that text chunk using a safer regex.
                let cleanFilenames = [];
                if (textChunk) {
                    // This regex now looks for filenames with extensions, avoiding URLs.
                    const filenameRegex = /`([^`]+?\.\w+)`|\(([^)\s/]+\.\w+)\)/g;
                    const matches = [...textChunk.text.matchAll(filenameRegex)];
                    cleanFilenames = matches.map(match => match[1] || match[2]);
                }

                // Step D: Process the collected file chunks, assigning names in order.
                fileChunks.forEach((fileChunk, index) => {
                    let textForDisplay = '[Uploaded Document]'; // Default fallback
                    if (index < cleanFilenames.length) {
                        // First file gets first name, second gets second, etc.
                        textForDisplay = `[File: ${cleanFilenames[index]}]`;
                    }

                    currentPrompts.push({
                        role: 'user',
                        text: null, // File chunks have no real text content
                        displayText: textForDisplay,
                        tokenCount: fileChunk.tokenCount,
                        originalIndexInChunks: fileChunk.originalIndexInChunks
                    });
                });

                // Step E: Jump the main loop index past the file chunks we just processed.
                i = fileScanIndex;
            }
        }

        populatePromptList();
        if (currentPrompts.length > 0) {
            displayPromptAndAnswer(0);
        } else {
            document.getElementById('prompt-list').innerHTML = '<p class="placeholder">No user prompts found in the file.</p>';
            document.getElementById('answer-view').innerHTML = '<p class="placeholder">No user prompts found to display.</p>';
        }
    }

function populatePromptList() {
    const promptListEl = document.getElementById('prompt-list');
    promptListEl.innerHTML = '';
    if (currentPrompts.length === 0) {
        promptListEl.innerHTML = '<p class="placeholder">No prompts to display.</p>';
        return;
    }
    currentPrompts.forEach((prompt, index) => {
        const listItem = document.createElement('div');
        listItem.classList.add('prompt-item');

        // Use the new displayText property for the list item's visible text.
        const textForListItem = prompt.displayText || 'Prompt with no text';

        // The full text for search/tooltip should use the displayText as a fallback.
        const fullTextForSearch = prompt.text || prompt.displayText || '';

        listItem.textContent = truncateText(textForListItem, 60);
        listItem.title = fullTextForSearch.substring(0, 200) + (fullTextForSearch.length > 200 ? '...' : '');
        listItem.setAttribute('data-full-text', fullTextForSearch);

        listItem.dataset.index = index;
        listItem.onclick = () => displayPromptAndAnswer(index);
        promptListEl.appendChild(listItem);
    });
}

    function createMessageDiv(chunk, isInitiallyCollapsed = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');

        // Determine message type and header text based on chunk.role
        let headerText = 'Unknown Role';
        if (chunk.role === 'user') {
            messageDiv.classList.add('user-message');
            headerText = 'User Prompt';
        } else if (chunk.role === 'model') {
            messageDiv.classList.add('model-message');
            if (chunk.isThought) {
                messageDiv.classList.add('thought-message');
                headerText = 'Model (Thought Process)';
            } else {
                headerText = 'Model Response';
            }
        }

        const headerDiv = document.createElement('div');
        headerDiv.classList.add('collapsible-header');

        const h3 = document.createElement('h3');
        h3.textContent = headerText;
        headerDiv.appendChild(h3);

        const toggleBtn = document.createElement('button');
        toggleBtn.classList.add('toggle-button');
        // User prompts are generally not collapsed by default unless it's in complete dialog
        toggleBtn.textContent = isInitiallyCollapsed ? '[+]' : '[-]';
        headerDiv.appendChild(toggleBtn);

        messageDiv.appendChild(headerDiv);

        const metadataDiv = document.createElement('div');
        metadataDiv.classList.add('metadata');
        metadataDiv.textContent = `Tokens: ${chunk.tokenCount || 'N/A'}`;
        messageDiv.appendChild(metadataDiv);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        const rawHtml = marked.parse(chunk.text || '');
        contentDiv.innerHTML = DOMPurify.sanitize(rawHtml);
        messageDiv.appendChild(contentDiv);

        contentDiv.querySelectorAll('pre').forEach(pre => {
            addCopyButtonToPre(pre);
            // Ensure code tag exists for highlight.js, if not, wrap pre content
            let codeTag = pre.querySelector('code');
            if (!codeTag) {
                const preContent = pre.innerHTML;
                pre.innerHTML = ''; // Clear current content
                codeTag = document.createElement('code');
                // If preContent was already HTML (e.g., from marked), set innerHTML
                // Otherwise, if it's plain text, set textContent
                // For safety and simplicity with marked output, assume it's HTML-ish
                codeTag.innerHTML = preContent;
                pre.appendChild(codeTag);
            }
            hljs.highlightElement(codeTag);
        });

        if (isInitiallyCollapsed) {
            messageDiv.classList.add('collapsed');
        }

        return messageDiv;
    }

    function toggleCollapsibleMessage(messageDiv) {
        messageDiv.classList.toggle('collapsed');
        const toggleBtn = messageDiv.querySelector('.collapsible-header .toggle-button');
        if (toggleBtn) {
            toggleBtn.textContent = messageDiv.classList.contains('collapsed') ? '[+]' : '[-]';
        }
    }

    function displayPromptAndAnswer(promptIndex) {
        if (!parsedData || promptIndex >= currentPrompts.length) return;

        document.querySelectorAll('#prompt-list .prompt-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === parseInt(item.dataset.index) && idx === promptIndex);
        });
        document.getElementById('viewCompleteDialogBtn').classList.remove('active');

        const answerViewEl = document.getElementById('answer-view');
        answerViewEl.innerHTML = '';

        const selectedUserPrompt = currentPrompts[promptIndex]; // This now has role: 'user'
        const originalChunkIndex = selectedUserPrompt.originalIndexInChunks;

        const promptDiv = createMessageDiv(selectedUserPrompt, false);
        answerViewEl.appendChild(promptDiv);

        const allChunks = parsedData.chunkedPrompt.chunks;
        let modelResponseFound = false;
        for (let i = originalChunkIndex + 1; i < allChunks.length; i++) {
            const chunk = allChunks[i];
            if (chunk.role === 'model') {
                modelResponseFound = true;
                const isThought = chunk.isThought || false;
                const modelDiv = createMessageDiv(chunk, isThought);
                answerViewEl.appendChild(modelDiv);
            } else if (chunk.role === 'user') {
                break;
            }
        }
        if (!modelResponseFound) {
            const noResponseDiv = document.createElement('p');
            noResponseDiv.classList.add('placeholder');
            noResponseDiv.textContent = 'No model response followed this prompt directly.';
            answerViewEl.appendChild(noResponseDiv);
        }
    }

    function displayCompleteDialog() {
        if (!parsedData || !parsedData.chunkedPrompt?.chunks) {
            document.getElementById('answer-view').innerHTML = '<p class="placeholder">No data loaded for complete dialog.</p>';
            return;
        }
        document.querySelectorAll('#prompt-list .prompt-item.active').forEach(item => item.classList.remove('active'));
        document.getElementById('viewCompleteDialogBtn').classList.add('active');

        const answerViewEl = document.getElementById('answer-view');
        answerViewEl.innerHTML = '<h2>Complete Dialog</h2>';

        parsedData.chunkedPrompt.chunks.forEach(chunk => {
            const isUserPrompt = chunk.role === 'user';
            const isThought = chunk.role === 'model' && (chunk.isThought || false);
            // In complete dialog, user prompts are expanded, thoughts are collapsed by default.
            // Regular model responses are also expanded.
            const messageDiv = createMessageDiv(chunk, isThought);
            answerViewEl.appendChild(messageDiv);
        });
    }

    function addCopyButtonToPre(preElement) {
        if (preElement.querySelector('.copy-code-btn')) return; // Don't add if already exists
        const copyButton = document.createElement('button');
        copyButton.classList.add('copy-code-btn');
        copyButton.textContent = 'Copy';
        preElement.style.position = 'relative';
        preElement.appendChild(copyButton);
    }

    function showCopyConfirmation() {
        copyConfirmationPopup.classList.add('show');
        setTimeout(() => {
            copyConfirmationPopup.classList.remove('show');
        }, 2000);
    }

    function displayRunDetails(settings) {
        const el = document.getElementById('run-details-content');
        el.innerHTML = '';
        if (!settings || Object.keys(settings).length === 0) {
            el.innerHTML = '<p class="placeholder">No run settings available.</p>';
            return;
        }
        let content = '<ul>';
        for (const key in settings) {
            let value = settings[key];
            if (typeof value === 'object') {
                // Wrap JSON in pre/code for potential highlighting by Highlight.js
                value = `<pre><code class="language-json">${DOMPurify.sanitize(JSON.stringify(value, null, 2))}</code></pre>`;
            } else {
                value = DOMPurify.sanitize(value.toString());
            }
            content += `<li><strong>${DOMPurify.sanitize(key)}:</strong> ${value}</li>`;
        }
        content += '</ul>';
        el.innerHTML = content;
        el.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    }

    function displayCitations(citations) {
        const el = document.getElementById('citations-content');
        el.innerHTML = '';
        if (!citations || citations.length === 0) {
            el.innerHTML = '<p class="placeholder">No citations provided.</p>';
            return;
        }
        let content = '<ul>';
        citations.forEach(citation => {
            const uri = DOMPurify.sanitize(citation.uri || '');
            content += `<li>URI: <a href="${uri}" target="_blank" rel="noopener noreferrer">${uri}</a></li>`;
        });
        content += '</ul>';
        el.innerHTML = content;
    }

    function displaySystemInstruction(instruction) {
        const el = document.getElementById('system-instruction-content');
        el.innerHTML = '';
        let contentToDisplay = '<p class="placeholder">No system instruction provided.</p>';
        if (instruction) {
            let textToParse = '';
            if (instruction.parts && Array.isArray(instruction.parts) && instruction.parts.length > 0) {
                textToParse = instruction.parts.map(p => p.text || '').join('\n');
            } else if (typeof instruction.text === 'string' && instruction.text.trim()) {
                textToParse = instruction.text;
            } else if (Object.keys(instruction).length > 0 && !(instruction.parts && instruction.parts.length === 0)) {
                textToParse = '```json\n' + JSON.stringify(instruction, null, 2) + '\n```';
            }

            if (textToParse.trim()) {
                contentToDisplay = `<div class="content">${DOMPurify.sanitize(marked.parse(textToParse))}</div>`;
            }
        }
        el.innerHTML = contentToDisplay;
        // Highlight any code blocks parsed by marked
        el.querySelectorAll('pre').forEach(pre => {
            addCopyButtonToPre(pre); // Add copy button
            let codeTag = pre.querySelector('code');
            if (!codeTag) { // Ensure code tag exists
                const preContent = pre.innerHTML;
                pre.innerHTML = '';
                codeTag = document.createElement('code');
                codeTag.innerHTML = preContent;
                pre.appendChild(codeTag);
            }
            hljs.highlightElement(codeTag);
        });
    }

    function truncateText(text, maxLength) {
        if (!text) return "Untitled Prompt";
        const firstLine = text.split('\n')[0];
        if (firstLine.length <= maxLength) return firstLine;
        return firstLine.substring(0, maxLength).trim() + '...';
    }

    function openTab(evt, tabId, clickedButton) {
        const tabcontent = document.querySelectorAll("#details-section .tab-content");
        tabcontent.forEach(tab => {
            tab.style.display = "none";
            tab.classList.remove("active");
        });

        const tablinks = document.querySelectorAll("#details-tabs .tab-link");
        tablinks.forEach(link => {
            link.classList.remove("active");
        });

        const currentTab = document.getElementById(tabId);
        if (currentTab) {
            currentTab.style.display = "block";
            currentTab.classList.add("active");
        }
        if (clickedButton) {
            clickedButton.classList.add("active");
        }
    }

    /**
     * Gathers all CSS from the document's stylesheets into a single string.
     * This allows us to embed the styles directly into the exported HTML file,
     * making it fully self-contained.
     * @returns {string} A string containing all CSS rules.
     */
    function getEmbeddedCss() {
        let css = '';

        // Hardcode the remote Highlight.js theme to avoid CORS issues and ensure it's always available.
        // This is the content of atom-one-dark.min.css
        css += `
        .hljs{display:block;overflow-x:auto;padding:.5em;color:#abb2bf;background:#282c34}.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}.hljs-doctag,.hljs-keyword,.hljs-formula{color:#c678dd}.hljs-section,.hljs-name,.hljs-selector-tag,.hljs-deletion,.hljs-subst{color:#e06c75}.hljs-literal{color:#56b6c2}.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#98c379}.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo,.hljs-number{color:#d19a66}.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-title{color:#61aeee}.hljs-built_in,.hljs-title.class_,.hljs-class .hljs-title{color:#e6c07b}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}.hljs-link{text-decoration:underline}
        `;

        // Iterate through the document's stylesheets (like your local styles.css)
        for (const sheet of document.styleSheets) {
            // Only read from local stylesheets to avoid security errors
            if (sheet.href && !sheet.href.startsWith(window.location.origin)) {
                continue;
            }
            try {
                for (const rule of sheet.cssRules) {
                    css += rule.cssText;
                }
            } catch (e) {
                console.warn("Could not read CSS rules from stylesheet:", sheet.href, e);
            }
        }
        return css;
    }

/**
 * Generates a complete, self-contained HTML file from the loaded conversation,
 * with each message in a collapsible <details> section, and triggers a download.
 */
function exportConversationToHtml() {
    if (!parsedData) return;

    console.log("Starting HTML export with collapsible sections...");

    // 1. Get the content of the metadata sections from the DOM
    const runDetailsHtml = document.getElementById('run-details-container').outerHTML;
    const citationsHtml = document.getElementById('citations-container').outerHTML;
    const systemInstructionHtml = document.getElementById('system-instruction-container').outerHTML;

    // 2. Generate the complete dialog HTML, wrapping each message in <details>
    const conversationContainer = document.createElement('div');
    parsedData.chunkedPrompt.chunks.forEach(chunk => {
        // Create the standard message div, but we will only use its content
        const messageDiv = createMessageDiv(chunk, false);
        // The original header is not needed; the <summary> will replace it.
        messageDiv.querySelector('.collapsible-header')?.remove();

        const details = document.createElement('details');
        const summary = document.createElement('summary');

        // Determine the text and style for the summary based on the chunk type
        let summaryText = 'Message';
        let summaryClass = '';
        const previewText = truncateText(chunk.text || (chunk.driveDocument ? '[Uploaded Document]' : '[No Text]'), 120);

        if (chunk.role === 'user') {
            summaryText = 'User Prompt';
            summaryClass = 'summary-user';
        } else if (chunk.role === 'model') {
            if (chunk.isThought) {
                summaryText = 'Model (Thought Process)';
                summaryClass = 'summary-thought';
            } else {
                summaryText = 'Model Response';
                summaryClass = 'summary-model';
            }
        }

        summary.className = `summary-base ${summaryClass}`;
        // The summary will contain the type of message and a preview of the content
        summary.innerHTML = `<strong>${summaryText}:</strong> <span>${DOMPurify.sanitize(previewText)}</span>`;

        details.appendChild(summary);
        details.appendChild(messageDiv); // The message content now lives inside the <details> tag

        conversationContainer.appendChild(details);
    });
    const conversationHtml = conversationContainer.innerHTML;

    // 3. Gather all necessary CSS
    const embeddedCss = getEmbeddedCss();

    // 4. Assemble the final HTML document string
    const finalHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gemini Conversation Export</title>
            <style>
                /* Additional styles for a clean, static, collapsible export page */
                body { background-color: #f4f6f8; margin: 0; padding: 1em; }
                .export-wrapper { max-width: 900px; margin: 2em auto; background-color: #ffffff; border: 1px solid #e0e0e0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                #main-content { padding: 20px; }
                .tab-content, .collapsible-content { display: block !important; }
                .copy-code-btn, .toggle-visibility-btn { display: none; }
                .prompt-item, #sidebar, .header-meta, .controls, #searchPrompts { display: none; }
                header h1 { text-align: center; width: 100%;}

                /* NEW styles for <details> and <summary> */
                details {
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    margin-bottom: 1em;
                    overflow: hidden; /* Keeps the rounded corners nice */
                }
                details .message {
                    border: none; /* The <details> tag provides the border now */
                    margin-bottom: 0;
                }
                .summary-base {
                    padding: 12px 15px;
                    cursor: pointer;
                    font-weight: 500;
                    outline: none;
                    transition: background-color 0.2s ease;
                }
                .summary-base:hover {
                    background-color: #f0f0f0;
                }
                .summary-base strong { margin-right: 10px; }
                .summary-base span { font-weight: normal; font-style: italic; color: #555; }

                /* Style summaries to match the message types */
                .summary-user { background-color: #e9f5fd; border-left: 5px solid #3498db; }
                .summary-model { background-color: #e8f6f3; border-left: 5px solid #2ecc71; }
                .summary-thought { background-color: #fef9e7; border-left: 5px solid #f1c40f; }
            </style>
            <style>
                ${embeddedCss}
            </style>
        </head>
        <body>
            <div class="export-wrapper">
                <header><h1>Gemini Conversation Export</h1></header>
                <main id="main-content">
                    <div id="details-section">
                        <div id="details-tabs"></div>
                        ${runDetailsHtml}
                        ${systemInstructionHtml}
                        ${citationsHtml}
                    </div>
                    <hr>
                    <h2>Complete Dialog</h2>
                    <div id="answer-view">
                        ${conversationHtml}
                    </div>
                </main>
            </div>
        </body>
        </html>
    `;

    // 5. Trigger the download
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gemini-conversation.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("Collapsible HTML export complete.");
}

/**
 * Generates and triggers the download of a self-contained HTML file for the conversation.
 */
function exportConversationToHtml() {
    if (!parsedData) return;

    console.log("Starting HTML export...");

    // 1. Prepare Content Pieces
    const title = "AI Studio Prompt Archive";
    const allChunks = parsedData.chunkedPrompt?.chunks || [];

    // --- Date handling logic ---
    let exportDateString;
    // Look for a hypothetical 'creationTime' or 'exportTime' in the JSON data.
    // This makes the script future-proof if the format changes.
    const jsonDate = parsedData.creationTime || parsedData.exportTime;
    if (jsonDate) {
        exportDateString = new Date(jsonDate).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    } else {
        // Fallback to the current date and time if no date is found in the JSON
        exportDateString = "Exported on " + new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    const runDetailsHtml = document.getElementById('run-details-container').outerHTML;
    const citationsHtml = document.getElementById('citations-container').outerHTML;
    const systemInstructionHtml = document.getElementById('system-instruction-container').outerHTML;
    const metadataHtml = runDetailsHtml + systemInstructionHtml + citationsHtml;

    // Generate conversation HTML...
    const conversationContainer = document.createElement('div');
    for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        const messageDiv = createMessageDiv(chunk, false);
        messageDiv.querySelector('.collapsible-header')?.remove();

        const details = document.createElement('details');
        const summary = document.createElement('summary');

        let summaryText = 'Message';
        let summaryClass = '';
        let previewText = chunk.text || '[No Text]';

        if (chunk.driveDocument) {
            previewText = '[Uploaded Document]';
            const nextChunk = allChunks[i + 1];
            if (nextChunk && nextChunk.role === 'user' && nextChunk.text) {
                const filenameMatch = nextChunk.text.match(/`([^`]+)`/);
                if (filenameMatch && filenameMatch[1]) {
                    previewText = `[File: ${filenameMatch[1]}]`;
                }
            }
        }

        previewText = truncateText(previewText, 120);

        if (chunk.role === 'user') {
            summaryText = 'User Prompt';
            summaryClass = 'summary-user';
        } else if (chunk.role === 'model') {
            summaryText = chunk.isThought ? 'Model (Thought Process)' : 'Model Response';
            summaryClass = chunk.isThought ? 'summary-thought' : 'summary-model';
        }

        summary.className = `summary-base ${summaryClass}`;
        summary.innerHTML = `<strong>${summaryText}:</strong> <span>${DOMPurify.sanitize(previewText)}</span>`;

        details.appendChild(summary);
        details.appendChild(messageDiv);
        conversationContainer.appendChild(details);
    }
    const conversationHtml = conversationContainer.innerHTML;

    // 2. Get Templates and CSS
    const embeddedCss = getEmbeddedCss();
    const footer = getExportFooterHtml();
    let finalHtml = getExportHtmlTemplate();

    // 3. Populate the Template
    finalHtml = finalHtml
        .replaceAll('%%TITLE%%', title)
        .replaceAll('%%EXPORT_DATE%%', exportDateString)
        .replaceAll('%%EMBEDDED_CSS%%', embeddedCss)
        .replaceAll('%%METADATA_HTML%%', metadataHtml)
        .replaceAll('%%CONVERSATION_HTML%%', conversationHtml)
        .replaceAll('%%FOOTER_HTML%%', footer.html)
        .replaceAll('%%FOOTER_CSS%%', footer.css);

    // 4. Trigger the download
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-studio-archive.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("HTML export complete.");
}

/**
 * Provides the HTML structure for the export file.
 * Uses placeholders (e.g., %%TITLE%%) that will be replaced with dynamic content.
 * @returns {string} The HTML template string.
 */
function getExportHtmlTemplate() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>%%TITLE%%</title>
            <style>
                /* Base styles for a clean, static, collapsible export page */
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 1em; }
                .export-wrapper { max-width: 900px; margin: 2em auto; background-color: #ffffff; border: 1px solid #e0e0e0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                #main-content { padding: 20px; }
                header { background-color: #ffffff; padding: 20px; border-bottom: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: center; }
                header h1 { margin: 0; font-size: 1.6em; color: #2c3e50; }

                /* NEW: Style for the date */
                .export-date {
                    margin: 0.5em 0 0 0;
                    font-size: 0.9em;
                    color: #888;
                }

                hr { border: 0; border-top: 1px solid #eee; margin: 2em 0; }
                h2 { border-bottom: 1px solid #eee; padding-bottom: 0.5em; }

                /* Hide viewer-specific UI elements */
                .tab-content, .collapsible-content { display: block !important; }
                .copy-code-btn, .toggle-visibility-btn { display: none; }
                #details-tabs { display: none; }

                /* Styles for collapsible <details> and <summary> sections */
                details { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 1em; overflow: hidden; }
                details[open] summary { border-bottom: 1px solid #e0e0e0; }
                details .message { border: none; margin-bottom: 0; }
                .summary-base { padding: 12px 15px; cursor: pointer; font-weight: 500; outline: none; transition: background-color 0.2s ease; display: flex; align-items: baseline; }
                .summary-base:hover { background-color: #f0f0f0; }
                .summary-base strong { margin-right: 10px; flex-shrink: 0; }
                .summary-base span { font-weight: normal; font-style: italic; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .summary-user { background-color: #e9f5fd; border-left: 5px solid #3498db; }
                .summary-model { background-color: #e8f6f3; border-left: 5px solid #2ecc71; }
                .summary-thought { background-color: #fef9e7; border-left: 5px solid #f1c40f; }

                /* Footer Styles */
                %%FOOTER_CSS%%
            </style>
            <style>
                %%EMBEDDED_CSS%%
            </style>
        </head>
        <body>
            <div class="export-wrapper">
                <header>
                    <h1>%%TITLE%%</h1>
                    <p class="export-date">%%EXPORT_DATE%%</p> <!-- NEW: Date placeholder -->
                </header>
                <main id="main-content">
                    <div id="details-section">
                        %%METADATA_HTML%%
                    </div>
                    <hr>
                    <h2>Complete Dialog</h2>
                    <div id="answer-view">
                        %%CONVERSATION_HTML%%
                    </div>
                </main>
            </div>
            %%FOOTER_HTML%%
        </body>
        </html>
    `;
}

/**
 * Provides the HTML and CSS for the footer.
 * @returns {object} An object containing the footer's HTML and CSS.
 */
function getExportFooterHtml() {
    const footerCss = `
        /* Styles for a static footer at the bottom of the page */
        .export-footer {
            max-width: 900px;      /* Match the main container's width */
            margin: 2em auto;      /* Center the block and provide vertical space */
            padding-top: 1.5em;    /* Space above the footer content */
            border-top: 1px solid #eee; /* A subtle separator line */
            font-size: 0.8em;
            color: #777;
            text-align: center;    /* Center the text */
            line-height: 1.6;
        }
        .export-footer a {
            color: #3498db;
            text-decoration: none;
        }
        .export-footer a:hover {
            text-decoration: underline;
        }
    `;

    const footerHtml = `
        <footer class="export-footer">
            Developed by Marcel Mayr (<a href="https://github.com/marcelamayr" target="_blank" rel="noopener noreferrer">marcelamayr on GitHub</a>, <a href="https://marcelamayr.com" target="_blank" rel="noopener noreferrer">@marcelamayr on social media</a>)<br>
            Extended by Alexander Dunkel (<a href="https://github.com/Sieboldianus" target="_blank" rel="noopener noreferrer">sieboldianus on Github</a>, <a href="https://himself.alexanderdunkel.com/" target="_blank" rel="noopener noreferrer">@alex on social media</a>)
        </footer>
    `;

    return { html: footerHtml, css: footerCss };
}

});