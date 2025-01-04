from flask import Flask, request, jsonify, render_template, send_file, Response, url_for
from flask_cors import CORS
import logging
from cerebras.cloud.sdk import Cerebras
import os
import tempfile
from gtts import gTTS
import PyPDF2
from werkzeug.utils import secure_filename
from datetime import datetime
import fitz  # This is how we import PyMuPDF

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Flask app setup
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# API Configuration
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
if not CEREBRAS_API_KEY:
    raise EnvironmentError("CEREBRAS_API_KEY is not set in the environment variables")

# Initialize Cerebras client
cerebras_client = Cerebras(api_key=CEREBRAS_API_KEY)

# Configure upload folder
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), UPLOAD_FOLDER)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Store uploaded PDFs temporarily
TEMP_PDF_STORAGE = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(file_path):
    try:
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text
    except Exception as e:
        logger.error(f"Error extracting text from PDF: {e}")
        raise

def summarize_text(content, is_selection=False):
    try:
        system_prompt = """You are an expert at summarizing academic content.
        Create a clear, concise summary that captures the main points."""
        
        user_prompt = f"""Summarize this {'selected text' if is_selection else 'research paper'}:

        {content[:3000]}  # Limit content for API

        Keep it concise but informative."""

        response = cerebras_client.generate(
            model="llama3.1-8b",
            prompt=f"{system_prompt}\n\n{user_prompt}",
            max_tokens=500,
            temperature=0.7
        )

        return response.text

    except Exception as e:
        logger.error(f"Error generating summary: {e}")
        raise

def generate_podcast_script(content):
    try:
        system_prompt = """You are an expert at creating engaging podcast scripts from academic content. 
        Convert this research paper into a natural conversational narrative.
        Important: Do not use any speaker labels, names, or markers like 'Host A' or 'Host B'.
        Present the content as a flowing narrative that can be read naturally by text-to-speech."""
        
        user_prompt = f"""Create an engaging podcast script about this research paper:

        {content[:3000]}  # Limit content for API

        Requirements:
        - Present as a natural flowing narrative
        - No speaker labels or markers
        - Include 3-4 main points from the paper
        - Keep the tone conversational but informative
        - Avoid any special characters or formatting
        """

        response = cerebras_client.generate(
            model="llama3.1-8b",
            prompt=f"{system_prompt}\n\n{user_prompt}",
            max_tokens=1000,
            temperature=0.7
        )

        # Clean up the response to remove any remaining markers or special characters
        script = response.text
        script = script.replace('Host A:', '').replace('Host B:', '')
        script = script.replace('Q:', '').replace('A:', '')
        script = ' '.join(script.split())  # Normalize whitespace
        
        return script

    except Exception as e:
        logger.error(f"Error generating podcast script: {e}")
        raise

def chat_with_paper(paper_content, user_question, selected_text=None):
    try:
        context = selected_text if selected_text else paper_content[:2000]
        
        system_prompt = """You are an AI research assistant helping users understand 
        academic papers. Provide clear, accurate responses based on the paper's content."""
        
        user_prompt = f"""Based on this research paper content:

        {context}

        Answer this question: {user_question}

        Provide a clear, concise response that directly addresses the question."""

        response = cerebras_client.generate(
            model="llama3.1-8b",
            prompt=f"{system_prompt}\n\n{user_prompt}",
            max_tokens=500,
            temperature=0.7
        )

        return response.text

    except Exception as e:
        logger.error(f"Error in chat response: {e}")
        raise

def text_to_speech(text, voice='en'):
    try:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
        tts = gTTS(text=text, lang=voice)
        tts.save(temp_file.name)
        return temp_file.name
    except Exception as e:
        logger.error(f"Error in text_to_speech: {e}")
        raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload_paper', methods=['POST'])
def upload_paper():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            
            # Store the file path temporarily
            file_id = datetime.now().strftime('%Y%m%d%H%M%S')
            TEMP_PDF_STORAGE[file_id] = file_path
            
            # Extract text from PDF
            paper_content = extract_text_from_pdf(file_path)
            
            # Generate initial summary
            summary = summarize_text(paper_content)
            
            return jsonify({
                'file_id': file_id,
                'paper_content': paper_content,
                'summary': summary,
                'filename': filename
            })
            
        return jsonify({'error': 'Invalid file type'}), 400
        
    except Exception as e:
        logger.error(f"Error in upload_paper: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_pdf/<file_id>', methods=['GET'])
def get_pdf(file_id):
    try:
        if file_id in TEMP_PDF_STORAGE:
            return send_file(
                TEMP_PDF_STORAGE[file_id],
                mimetype='application/pdf',
                as_attachment=False
            )
        return jsonify({'error': 'PDF not found'}), 404
    except Exception as e:
        logger.error(f"Error in get_pdf: {e}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/summarize_selection', methods=['POST'])
def summarize_selection():
    try:
        data = request.get_json()
        selected_text = data.get('selected_text')
        
        if not selected_text:
            return jsonify({'error': 'No text selected'}), 400
            
        # Generate summary for selected text
        summary = summarize_text(selected_text, is_selection=True)
        return jsonify({'summary': summary})
        
    except Exception as e:
        logger.error(f"Error in summarize_selection: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/chat_with_paper', methods=['POST'])
def chat_with_paper_endpoint():
    try:
        data = request.get_json()
        paper_content = data.get('paper_content')
        question = data.get('question')
        selected_text = data.get('selected_text')
        
        if not paper_content or not question:
            return jsonify({'error': 'Missing paper content or question'}), 400
            
        response = chat_with_paper(paper_content, question, selected_text)
        return jsonify({'response': response})
        
    except Exception as e:
        logger.error(f"Error in chat_with_paper: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_podcast', methods=['POST'])
def generate_podcast():
    try:
        data = request.get_json()
        paper_content = data.get('paper_content')
        
        if not paper_content:
            return jsonify({'error': 'Missing paper content'}), 400
            
        script = generate_podcast_script(paper_content)
        return jsonify({'podcast_script': script})
        
    except Exception as e:
        logger.error(f"Error in generate_podcast: {e}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/generate_audio', methods=['POST'])
def generate_audio():
    try:
        data = request.get_json()
        text = data.get('text')
        voice = data.get('voice', 'en')
        
        if not text:
            return jsonify({'error': 'Text not provided'}), 400
        
        audio_file = text_to_speech(text, voice)
        return send_file(
            audio_file,
            mimetype='audio/mp3',
            as_attachment=True,
            download_name='research_audio.mp3'
        )
    except Exception as e:
        logger.error(f"Error in generate_audio: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/convert_to_notes', methods=['POST'])
def convert_to_notes():
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'No text provided'}), 400
        
        system_prompt = """You are an expert at converting academic text into comprehensive study notes.
        Create detailed, well-structured notes that capture the main points and supporting details."""
        
        user_prompt = f"""Convert this text into comprehensive study notes:

        {text}

        Format the notes with:
        - A clear summary
        - Key points with explanations
        - Important concepts and definitions
        - Related topics and implications
        Use bullet points and proper formatting."""

        response = cerebras_client.generate(
            model="llama3.1-8b",
            prompt=f"{system_prompt}\n\n{user_prompt}",
            max_tokens=1000,
            temperature=0.7
        )
        
        notes = response.text
        return jsonify({'notes': notes})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(debug=True, port=port)
