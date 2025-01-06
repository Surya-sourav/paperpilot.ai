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

// Magic Select Handler
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
            // Insert notes at current cursor position or at the end
            const range = quill.getSelection(true);
            const index = range ? range.index : quill.getLength();
            quill.insertText(index, '\n' + data.notes + '\n');
            
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
        const response = await fetch('/summarize_selection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ selected_text: paperContent })
        });
        
        const data = await response.json();
        if (response.ok) {
            summaryCache[cacheKey] = data.summary;
            summaryResult.textContent = data.summary;
        } else {
            showError(data.error || 'Error generating summary');
        }
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

// Podcast Functionality
document.querySelector('[data-tab="podcast"]').addEventListener('click', async () => {
    const cacheKey = paperContent;
    if (podcastCache[cacheKey]) {
        podcastScript.textContent = podcastCache[cacheKey];
        audioPlayer.style.display = 'block';
        return;
    }
    
    showLoading(true);
    try {
        const response = await fetch('/generate_podcast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ paper_content: paperContent })
        });
        
        const data = await response.json();
        if (response.ok) {
            podcastCache[cacheKey] = data.podcast_script;
            podcastScript.textContent = data.podcast_script;
            audioPlayer.style.display = 'block';
            
            if (!document.getElementById('generateAudioBtn')) {
                const generateBtn = document.createElement('button');
                generateBtn.id = 'generateAudioBtn';
                generateBtn.className = 'action-button';
                generateBtn.innerHTML = '<i class="fas fa-play"></i> Generate Audio';
                generateBtn.onclick = () => generateAudio(data.podcast_script);
                audioPlayer.insertBefore(generateBtn, audioPlayer.firstChild);
            }
        } else {
            showError(data.error || 'Error generating podcast');
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
        const response = await fetch('/generate_audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = audioPlayer.querySelector('audio');
            audio.src = url;
            // Don't autoplay
        } else {
            const data = await response.json();
            showError(data.error || 'Error generating audio');
        }
    } catch (error) {
        showError('Error generating audio');
    } finally {
        showLoading(false);
    }
}

// Utility Functions
function showLoading(show) {
    loadingElement.style.display = show ? 'block' : 'none';
}

function showError(message) {
    alert(message);
}

// Add save notes as PDF functionality
async function saveNotesAsPDF() {
    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        
        // Get notes content from Quill editor
        const notesContent = quill.root.innerText;
        
        // Split content into chunks to avoid exceeding context length
        const chunks = chunkText(notesContent, 5000); // Split into 5000 char chunks
        
        for (const chunk of chunks) {
            let page = pdfDoc.addPage();
            const { width, height } = page.getSize();
            
            // Set some basic styling
            const fontSize = 12;
            const margin = 50;
            const lineHeight = 1.2;
            const maxWidth = width - 2 * margin;
            
            // Split chunk into lines that fit within the page width
            const words = chunk.split(' ');
            let lines = [''];
            let currentLine = 0;
            
            words.forEach(word => {
                const testLine = lines[currentLine] + word + ' ';
                const testWidth = timesRomanFont.widthOfTextAtSize(testLine, fontSize);
                
                if (testWidth <= maxWidth) {
                    lines[currentLine] = testLine;
                } else {
                    currentLine++;
                    lines[currentLine] = word + ' ';
                }
            });
            
            // Draw text on pages
            let y = height - margin;
            const linesPerPage = Math.floor((height - 2 * margin) / (fontSize * lineHeight));
            
            lines.forEach((line, index) => {
                // Create new page if needed
                if (index > 0 && index % linesPerPage === 0) {
                    page = pdfDoc.addPage();
                    y = height - margin;
                }
                
                page.drawText(line.trim(), {
                    x: margin,
                    y: y,
                    size: fontSize,
                    font: timesRomanFont,
                    color: rgb(0, 0, 0),
                    lineHeight: fontSize * lineHeight,
                });
                
                y -= fontSize * lineHeight;
                
                // Reset y position for new page
                if (y < margin) {
                    y = height - margin;
                }
            });
        }
        
        // Save the PDF
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const link = document.createElement('a');
        link.href = url;
        link.download = 'research_notes.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error saving PDF:', error);
        showError('Error saving notes as PDF');
    }
}

// Update the save PDF button event listener
document.querySelector('.save-pdf-btn').addEventListener('click', saveNotesAsPDF);


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
