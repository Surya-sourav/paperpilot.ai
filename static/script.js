// Global variables
let paperContent = '';
let selectedText = '';
let currentPage = 1;
let totalPages = 1;
let currentPdf = null;
let summaryCache = {};
let podcastCache = {};

// Initialize Quill editor
let quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
        toolbar: [
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote', 'code-block'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'script': 'sub'}, { 'script': 'super' }],
            [{ 'indent': '-1'}, { 'indent': '+1' }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'align': [] }],
            ['clean']
        ]
    },
    placeholder: 'Start taking notes...'
});

// DOM Elements
const uploadSection = document.getElementById('uploadSection');
const splitInterface = document.getElementById('splitInterface');
const pdfViewer = document.getElementById('pdfViewer');
const pageInfo = document.getElementById('pageInfo');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const notesEditor = document.getElementById('editor');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const summaryResult = document.getElementById('summaryResult');
const podcastScript = document.getElementById('podcastScript');
const audioPlayer = document.getElementById('audioPlayer');
const loadingElement = document.getElementById('loading');

// Feature tabs
const tabs = document.querySelectorAll('.feature-tab');
const tabContents = document.querySelectorAll('.feature-tab-content');

// Add click handlers for feature tabs
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        
        // Remove active class from all tabs and contents
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab and its content
        tab.classList.add('active');
        document.getElementById(`${targetTab}Tab`).classList.add('active');
    });
});

// Modal Elements and Handlers
const modals = {
    info: document.getElementById('infoModal'),
    pricing: document.getElementById('pricingModal'),
    contact: document.getElementById('contactModal')
};

// Modal Buttons
document.getElementById('infoBtn').addEventListener('click', () => openModal('info'));
document.getElementById('pricingBtn').addEventListener('click', () => openModal('pricing'));
document.getElementById('contactBtn').addEventListener('click', () => openModal('contact'));

// Close buttons for all modals
document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        Object.values(modals).forEach(modal => modal.style.display = 'none');
    });
});

function openModal(modalId) {
    Object.values(modals).forEach(modal => modal.style.display = 'none');
    modals[modalId].style.display = 'block';
}

// PDF Navigation Functions
async function loadPDFPage(pageNum) {
    try {
        const page = await currentPdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        
        // Create canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // Create text layer
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.width = `${viewport.width}px`;
        
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.appendChild(canvas);
        wrapper.appendChild(textLayerDiv);
        
        // Clear viewer and add new page
        pdfViewer.innerHTML = '';
        pdfViewer.appendChild(wrapper);
        
        // Render page
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        
        // Render text layer
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });
        
        // Add selection handler
        textLayerDiv.addEventListener('mouseup', () => {
            selectedText = window.getSelection().toString().trim();
        });
        
        // Update navigation
        currentPage = pageNum;
        updateNavigation();
        
    } catch (error) {
        showError('Error loading PDF page');
        console.error(error);
    }
}

function updateNavigation() {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

// Navigation event listeners
prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        loadPDFPage(currentPage - 1);
    }
});

nextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
        loadPDFPage(currentPage + 1);
    }
});

// File Upload Handler
document.getElementById('pdf-upload').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        showLoading(true);
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/upload_paper', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                paperContent = data.paper_content;
                
                // Show split interface
                uploadSection.style.display = 'none';
                splitInterface.style.display = 'flex';
                
                // Initialize PDF viewer
                const pdfUrl = `/get_pdf/${data.file_id}`;
                
                // Load PDF
                const loadingTask = pdfjsLib.getDocument(pdfUrl);
                loadingTask.promise.then(pdf => {
                    currentPdf = pdf;
                    totalPages = pdf.numPages;
                    loadPDFPage(1);
                });
                
            } else {
                showError(data.error || 'Error processing paper');
            }
        } catch (error) {
            showError('Error uploading file');
            console.error(error);
        } finally {
            showLoading(false);
        }
    } else {
        showError('Please upload a PDF file');
    }
});

// Magic Select Handler with improved note saving
document.querySelector('.magic-select-btn').addEventListener('click', async () => {
    if (!selectedText) {
        showError('Please select some text first');
        return;
    }
    
    showLoading(true);
    try {
        const response = await fetch('/convert_to_notes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: selectedText })
        });
        
        const data = await response.json();
        if (response.ok) {
            // Insert notes with proper formatting
            const range = quill.getSelection(true);
            const index = range ? range.index : quill.getLength();
            
            // Insert with proper Delta operations
            quill.updateContents([
                { insert: '\n' },
                { insert: data.notes, attributes: { bold: true } },
                { insert: '\n\n' }
            ], 'user');
            
            // Clear selection
            window.getSelection().removeAllRanges();
            selectedText = '';
        } else {
            showError(data.error || 'Error converting to notes');
        }
    } catch (error) {
        showError('Error converting text to notes');
        console.error(error);
    } finally {
        showLoading(false);
    }
});



// Chat Functionality
chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askQuestion();
    }
});

async function askQuestion() {
    const question = chatInput.value.trim();
    if (!question) {
        showError('Please enter a question');
        return;
    }
    
    addChatMessage(question, 'user');
    chatInput.value = '';
    
    showLoading(true);
    try {
        const response = await fetch('/chat_with_paper', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                paper_content: paperContent,
                question: question,
                selected_text: selectedText
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            addChatMessage(data.response, 'ai');
        } else {
            showError(data.error || 'Error getting response');
        }
    } catch (error) {
        showError('Error communicating with server');
    } finally {
        showLoading(false);
    }
}

function addChatMessage(message, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}-message`;
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Summarize Functionality
document.querySelector('[data-tab="summarize"]').addEventListener('click', summarizeAll);

async function summarizeAll() {
    const cacheKey = paperContent;
    if (summaryCache[cacheKey]) {
        summaryResult.textContent = summaryCache[cacheKey];
        return;
    }
    
    showLoading(true);
    try {
        // Split content into chunks if it's too long
        const chunks = chunkText(paperContent, 4000);
        let fullSummary = '';
        
        for (const chunk of chunks) {
            const response = await fetch('/summarize_selection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ selected_text: chunk })
            });
            
            const data = await response.json();
            if (response.ok) {
                fullSummary += data.summary + '\n\n';
            } else {
                throw new Error(data.error || 'Error generating summary');
            }
        }
        
        summaryCache[cacheKey] = fullSummary.trim();
        summaryResult.textContent = fullSummary.trim();
    } catch (error) {
        showError('Error communicating with server');
    } finally {
        showLoading(false);
    }
}

// Summarize Selection Functionality
document.querySelector('.summarize-btn').addEventListener('click', async () => {
    if (!selectedText) {
        showError('Please select some text first');
        return;
    }
    
    showLoading(true);
    try {
        const response = await fetch('/summarize_selection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ selected_text: selectedText })
        });
        
        const data = await response.json();
        if (response.ok) {
            summaryResult.textContent = data.summary;
        } else {
            throw new Error(data.error || 'Error generating summary');
        }
    } catch (error) {
        showError('Error: ' + error.message);
    } finally {
        showLoading(false);
    }
});

// Updated Podcast Functionality with chunking
document.querySelector('[data-tab="podcast"]').addEventListener('click', async () => {
    const cacheKey = paperContent;
    if (podcastCache[cacheKey]) {
        podcastScript.textContent = podcastCache[cacheKey];
        audioPlayer.style.display = 'block';
        return;
    }
    
    showLoading(true);
    try {
        // Split content into smaller chunks to avoid context length limit
        const chunks = chunkText(paperContent, 4000);
        let fullScript = '';
        
        for (const chunk of chunks) {
            const response = await fetch('/generate_podcast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ paper_content: chunk })
            });
            
            const data = await response.json();
            if (response.ok) {
                fullScript += data.podcast_script + '\n\n';
                await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
            } else {
                throw new Error(data.error || 'Error generating podcast script');
            }
        }
        
        const finalScript = fullScript.trim();
        podcastCache[cacheKey] = finalScript;
        podcastScript.textContent = finalScript;
        audioPlayer.style.display = 'block';
        
        if (!document.getElementById('generateAudioBtn')) {
            const generateBtn = document.createElement('button');
            generateBtn.id = 'generateAudioBtn';
            generateBtn.className = 'action-button';
            generateBtn.innerHTML = '<i class="fas fa-play"></i> Generate Audio';
            generateBtn.onclick = () => generateAudio(finalScript);
            audioPlayer.insertBefore(generateBtn, audioPlayer.firstChild);
        }
    } catch (error) {
        showError('Error generating podcast');
        console.error(error);
    } finally {
        showLoading(false);
    }
});

async function generateAudio(text) {
    showLoading(true);
    try {
        // Split audio generation into chunks if needed
        const chunks = chunkText(text, 4000);
        const audioChunks = [];
        
        for (const chunk of chunks) {
            const response = await fetch('/generate_audio', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: chunk })
            });
            
            if (response.ok) {
                const blob = await response.blob();
                audioChunks.push(blob);
            } else {
                const data = await response.json();
                throw new Error(data.error || 'Error generating audio');
            }
        }
        
        // Combine audio chunks
        const combinedBlob = new Blob(audioChunks, { type: 'audio/mpeg' });
        const url = URL.createObjectURL(combinedBlob);
        const audio = audioPlayer.querySelector('audio');
        audio.src = url;
    } catch (error) {
        showError('Error generating audio');
        console.error(error);
    } finally {
        showLoading(false);
    }
}

// Improved PDF saving functionality
async function saveNotesAsPDF() {
    try {
        // First check if we have content to save
        const content = quill.getText().trim();
        if (!content) {
            showError('No content to save');
            return;
        }

        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        
        // Embed both regular and bold fonts
        const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

        // Get Quill contents as Delta
        const delta = quill.getContents();
        
        // Initialize first page
        let currentPage = pdfDoc.addPage();
        const { width, height } = currentPage.getSize();
        const margin = 50;
        const fontSize = 12;
        const lineHeight = fontSize * 1.5;
        let y = height - margin;
        let x = margin;

        // Process each operation in the Delta
        for (const op of delta.ops) {
            // Skip if not text content
            if (typeof op.insert !== 'string') continue;

            // Handle line breaks
            const textSegments = op.insert.split('\n');
            
            for (let i = 0; i < textSegments.length; i++) {
                const text = textSegments[i];
                
                // Select font based on formatting
                const font = (op.attributes && op.attributes.bold) ? boldFont : regularFont;
                
                // If text segment is empty and we have a line break, move to next line
                if (text === '' && i < textSegments.length - 1) {
                    y -= lineHeight;
                    x = margin;
                    
                    // Create new page if needed
                    if (y < margin) {
                        currentPage = pdfDoc.addPage();
                        y = height - margin;
                    }
                    continue;
                }
                
                // Split text into words
                const words = text.split(' ');
                let currentLine = '';
                
                // Process each word
                for (const word of words) {
                    const testLine = currentLine + (currentLine ? ' ' : '') + word;
                    const textWidth = font.widthOfTextAtSize(testLine, fontSize);
                    
                    // Check if we need to wrap to next line
                    if (textWidth > width - (2 * margin)) {
                        // Draw current line
                        if (currentLine) {
                            try {
                                currentPage.drawText(currentLine, {
                                    x,
                                    y,
                                    size: fontSize,
                                    font,
                                    color: rgb(0, 0, 0),
                                });
                            } catch (err) {
                                console.error('Error drawing text:', err);
                                // Continue with next line
                            }
                            
                            y -= lineHeight;
                            x = margin;
                            
                            // Create new page if needed
                            if (y < margin) {
                                currentPage = pdfDoc.addPage();
                                y = height - margin;
                            }
                        }
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                }
                
                // Draw remaining text
                if (currentLine) {
                    try {
                        currentPage.drawText(currentLine, {
                            x,
                            y,
                            size: fontSize,
                            font,
                            color: rgb(0, 0, 0),
                        });
                    } catch (err) {
                        console.error('Error drawing final text:', err);
                        // Continue with next segment
                    }
                }
                
                // Move to next line if we have more segments
                if (i < textSegments.length - 1) {
                    y -= lineHeight;
                    x = margin;
                    
                    // Create new page if needed
                    if (y < margin) {
                        currentPage = pdfDoc.addPage();
                        y = height - margin;
                    }
                }
            }
        }

        // Save and download the PDF
        try {
            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = 'research_notes.pdf';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error saving PDF:', err);
            throw new Error('Failed to generate PDF file');
        }
        
    } catch (error) {
        console.error('PDF Generation Error:', error);
        showError('Error saving notes as PDF: ' + (error.message || 'Unknown error'));
    }
}



// Utility Functions
function showLoading(show) {
    loadingElement.style.display = show ? 'block' : 'none';
}

function showError(message) {
    alert(message);
}

// Update the save PDF button event listener
document.querySelector('.save-pdf-btn').addEventListener('click', saveNotesAsPDF);

// Utility function to chunk text
function chunkText(text, maxLength) {
    const chunks = [];
    let currentChunk = '';
    
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

// Helper function to split text into lines
function splitTextIntoLines(text, font, fontSize, maxWidth) {
    const words = text.split(' ');
    const lines = [''];
    let currentLine = 0;

    words.forEach(word => {
        const testLine = lines[currentLine] + word + ' ';
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (testWidth <= maxWidth) {
            lines[currentLine] = testLine;
        } else {
            currentLine++;
            lines[currentLine] = word + ' ';
        }
    });

    return lines;
}

// Add styles for better text selection visibility
const styles = document.createElement('style');
styles.textContent = `
    ::selection {
        background-color: rgba(66, 66, 255, 0.8) !important;
        color: white !important;
    }

    .textLayer ::selection {
        background-color: rgba(66, 66, 255, 0.8) !important;
        color: white !important;
    }

    .pdf-page-wrapper .textLayer {
        opacity: 1;
        mix-blend-mode: multiply;
    }
`;
document.head.appendChild(styles);

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize animations
    gsap.from(".app-container", {duration: 1, opacity: 0, ease: "power3.out"});
    gsap.from("h1", {duration: 1, y: -50, opacity: 0, ease: "power3.out", delay: 0.3});
    gsap.from(".upload-section", {duration: 1, scale: 0.9, opacity: 0, ease: "power3.out", delay: 0.5});
    
    // Add PDF-lib script if not already present
    if (!window.PDFLib) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
        document.head.appendChild(script);
    }
});
