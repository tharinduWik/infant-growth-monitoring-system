from fastapi import APIRouter, File, UploadFile, HTTPException
import joblib
import numpy as np
import uuid
import librosa
import os
import noisereduce as nr  # <--- NEW IMPORT

router = APIRouter()

# --- 1. SETUP PATHS ---
current_dir = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(current_dir, '..', '..', 'mlModels', 'Cry')

# Model A: Pain vs No Pain
MODEL_A_PATH = os.path.join(MODELS_DIR, 'model_a_pain.pkl')
SCALER_A_PATH = os.path.join(MODELS_DIR, 'scaler_a.pkl')

# Model B: Hunger vs Normal
MODEL_B_PATH = os.path.join(MODELS_DIR, 'model_b_hunger.pkl')
SCALER_B_PATH = os.path.join(MODELS_DIR, 'scaler_b.pkl')

print(f"🔍 [CryRouter] Loading models from: {os.path.abspath(MODELS_DIR)}")

# --- 2. LOAD MODELS ---
models = {}
try:
    models['model_a'] = joblib.load(MODEL_A_PATH)
    models['scaler_a'] = joblib.load(SCALER_A_PATH)
    models['model_b'] = joblib.load(MODEL_B_PATH)
    models['scaler_b'] = joblib.load(SCALER_B_PATH)
    print("✅ [CryRouter] All Models & Scalers loaded successfully!")
except Exception as e:
    print(f"❌ [CryRouter] Error loading models. Check file names! Error: {e}")
    models = None

# --- 3. FEATURE EXTRACTOR (With Noise Cancellation) ---
def extract_audio_features(audio_path):
    try:
        # FIX 1: Force exactly 5.0 seconds
        audio, sample_rate = librosa.load(audio_path, sr=22050, duration=5.0)
        
        # Check for silence
        if np.max(np.abs(audio)) < 0.005:
            print("⚠️ WARNING: Audio file is silent!")
            return None

        # FIX 2: Apply Noise Cancellation
        try:
            # Prop_decrease=0.8 removes 80% of background noise (fans, wind)
            audio = nr.reduce_noise(y=audio, sr=sample_rate, prop_decrease=0.8)
        except Exception as ne:
            print(f"⚠️ Noise reduction failed (skipping): {ne}")

        features = []
        
        # 1. MFCC (Mean + Std)
        mfccs = librosa.feature.mfcc(y=audio, sr=sample_rate, n_mfcc=40)
        features.append(np.mean(mfccs, axis=1))
        features.append(np.std(mfccs, axis=1))

        # 2. Mel Spectrogram (Mean + Std)
        mel = librosa.feature.melspectrogram(y=audio, sr=sample_rate, n_mels=128)
        features.append(np.mean(mel, axis=1))
        features.append(np.std(mel, axis=1))
        
        # 3. Chroma (Mean)
        stft = np.abs(librosa.stft(y=audio))
        chroma = librosa.feature.chroma_stft(S=stft, sr=sample_rate)
        features.append(np.mean(chroma, axis=1))

        # 4. Spectral Contrast (Mean)
        contrast = librosa.feature.spectral_contrast(S=stft, sr=sample_rate)
        features.append(np.mean(contrast, axis=1))
        
        # Combine: 355 Features
        final_features = np.concatenate(features)
        return final_features.reshape(1, -1)
        
    except Exception as e:
        print(f"❌ Feature Extraction Error: {e}")
        return None

# --- 4. PREDICTION ROUTE ---
@router.post("/predict-cry")
async def predict_cry(file: UploadFile = File(...)):
    print(f"Received file: {file.filename}")
    print(f"Content type: {file.content_type}")
    content = await file.read()
    print(f"File size bytes: {len(content)}")
    await file.seek(0)

    if models is None:
        raise HTTPException(status_code=503, detail="Models not loaded properly")

    # Save Temp File based on content type mapping
    content_types_map = {
        "audio/wav": "wav",
        "audio/webm": "webm",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/webm;codecs=pcm": "webm",
        "audio/webm; codecs=opus": "webm",
        "video/webm": "webm"
    }
    ext_from_mime = content_types_map.get(file.content_type)
    if ext_from_mime:
        extension = ext_from_mime
    else:
        extension = file.filename.split(".")[-1] if "." in file.filename else "wav"
    temp_dir = os.path.join(current_dir, '..', 'tmp')
    os.makedirs(temp_dir, exist_ok=True)
    temp_filename = os.path.join(temp_dir, f"{uuid.uuid4()}.{extension}")
    
    try:
        content = await file.read()
        with open(temp_filename, "wb") as buffer:
            buffer.write(content)
        
        # Extract Features (Includes Noise Reduction)
        raw_features = extract_audio_features(temp_filename)
        
        if raw_features is None:
            raise HTTPException(status_code=400, detail="Audio is silent or invalid format")

        # --- 🧠 STAGE 1: IS IT PAIN? (Model A) ---
        features_a = models['scaler_a'].transform(raw_features)
        
        is_pain_prob = models['model_a'].predict_proba(features_a)[0]
        is_pain = models['model_a'].predict(features_a)[0]
        
        print(f"🧠 Stage 1 (Pain): Prediction={is_pain}, Probs={is_pain_prob}")

        if is_pain == 1:
            final_label = "pain_cry"
            confidence = float(is_pain_prob[1])
        else:
            # --- 🧠 STAGE 2: HUNGER OR NORMAL? (Model B) ---
            features_b = models['scaler_b'].transform(raw_features)
            
            is_hunger_prob = models['model_b'].predict_proba(features_b)[0]
            is_hunger = models['model_b'].predict(features_b)[0]
            
            print(f"🧠 Stage 2 (Hunger/Normal): Prediction={is_hunger}, Probs={is_hunger_prob}")

            if is_hunger == 1:
                final_label = "hunger_cry"
                confidence = float(is_hunger_prob[1])
            else:
                final_label = "normal_cry"
                confidence = float(is_hunger_prob[0])

        # Extract debug info: feature statistics and model probabilities
        debug_info = {
            "feature_mean": float(np.mean(raw_features)),
            "feature_std": float(np.std(raw_features)),
            "feature_min": float(np.min(raw_features)),
            "feature_max": float(np.max(raw_features)),
            "num_features": int(raw_features.shape[1]),
            "stage_1_probs": {"pain": float(is_pain_prob[1]), "not_pain": float(is_pain_prob[0])},
            "stage_2_probs": {"hunger": float(is_hunger_prob[1]), "normal": float(is_hunger_prob[0])},
        }

        return {
            "label": final_label,
            "confidence": confidence,
            "message": f"Detected: {final_label.replace('_', ' ').title()}",
            "debug_info": debug_info
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"🔥 CRITICAL ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        if os.path.exists(temp_filename):
            try: os.remove(temp_filename)
            except: pass