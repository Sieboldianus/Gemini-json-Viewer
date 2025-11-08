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

        for (let i = 0; i < allChunks.length; i++) {
            const chunk = allChunks[i];
            if (chunk.role === 'user') {
                let promptText = chunk.text;
                let displayLabel = promptText; // The text to be used for display purposes

                // If text is missing, check for a document
                if (!promptText && chunk.driveDocument) {
                    // Default placeholder
                    displayLabel = '[Uploaded Document]';

                    // Look ahead to the next chunk to find a potential filename
                    const nextChunk = allChunks[i + 1];
                    if (nextChunk && nextChunk.role === 'user' && nextChunk.text) {
                        // Use a regular expression to find something that looks like a filename in backticks or quotes.
                        const filenameMatch = nextChunk.text.match(/`([^`]+)`/); // Looks for `filename.ext`
                        if (filenameMatch && filenameMatch[1]) {
                            displayLabel = `[Uploaded File: ${filenameMatch[1]}]`;
                        }
                    }
                    // We use the displayLabel for the prompt list, but the 'text' for the content can remain null/undefined
                    promptText = displayLabel;
                }

                currentPrompts.push({
                    role: 'user',
                    text: promptText, // This text will be displayed in the main view
                    tokenCount: chunk.tokenCount,
                    originalIndexInChunks: i
                });
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
            listItem.textContent = truncateText(prompt.text, 60);
            listItem.title = prompt.text.substring(0, 200) + (prompt.text.length > 200 ? '...' : '');
            listItem.setAttribute('data-full-text', prompt.text);
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
});