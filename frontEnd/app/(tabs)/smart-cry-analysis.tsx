import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Dimensions,
  ActivityIndicator,
  Image,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing, BorderRadius, Typography } from '@/constants/theme';
import FeedbackModal from '@/components/FeedbackModal';

// --- CONFIGURATION ---
const normalizeBaseUrl = (value?: string) => {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    // Web: use dynamic hostname on port 9000
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `http://${window.location.hostname}:9000`;
    }
    // Native/default: use localhost:9000
    return 'http://127.0.0.1:9000';
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

const BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
const AUDIO_API = `${BASE_URL}/predict-cry`;
const FACE_API = `${BASE_URL}/predict-face`;
const FUSION_API = `${BASE_URL}/fusion/predict`;

console.log('🔗 API Base URL:', BASE_URL);

const { width: screenWidth } = Dimensions.get('window');

type FlowStep = 'record' | 'capture' | 'context' | 'result';

type FusionContext = {
  baby_age_months: number;
  time_since_feed_hours: number;
  time_since_sleep_hours: number;
  diaper_status: string;
  room_temperature_celsius: number;
};

type AudioApiResult = { label: string; confidence: number; message?: string; debug_info?: Record<string, any> };
type FaceApiResult = { label: string; confidence: number; message?: string; features?: Record<string, any> };
type FusionApiResult = {
  predicted_cry_reason: string;
  confidence: number;
  confidence_level?: string;
  confidence_message?: string;
  context_info?: string;
  all_class_probabilities?: Record<string, number>;
  disclaimer?: string;
  model_disagreement?: boolean;
};

export default function SmartAnalysisScreen() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState<FlowStep>('record');

  // Audio
  const [audioUri, setAudioUri] = useState<string | null>(null); // for playback (native file uri OR web objectURL)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null); // ONLY for web upload
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // Face
  const [faceUri, setFaceUri] = useState<string | null>(null);

  // Loading
  const [isLoading, setIsLoading] = useState(false);

  // Context
  const [babyAge, setBabyAge] = useState('');
  const [feedingTime, setFeedingTime] = useState('');
  const [sleepTime, setSleepTime] = useState('');
  const [diaperStatus, setDiaperStatus] = useState('Clean');
  const [roomTemperature, setRoomTemperature] = useState('');

  // Result
  const [analysisResult, setAnalysisResult] = useState<FusionApiResult & {
    recommendations: string[];
    audioPrediction?: string;
    audioConfidence?: number;
    imagePrediction?: string;
    imageConfidence?: number;
    audioModelInputs?: Record<string, any>;
    imageModelInputs?: Record<string, any>;
  } | null>(null);

  // Feedback modal
  const [showFeedback, setShowFeedback] = useState(false);

  // Native recording
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Duration timer
  const durationInterval = useRef<any>(null);
  const stopTimeoutRef = useRef<any>(null);
  const isStoppingRef = useRef(false);

  // Web recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioObjectUrlRef = useRef<string | null>(null);

  // Light mode colors
  const LIGHT_BG = '#F8F9FA';
  const LIGHT_CARD = '#FFFFFF';
  const LIGHT_TEXT = '#1F2933';
  const LIGHT_SECONDARY = '#6B7280';
  const shadowColor = '#000';

  const backgroundColor = LIGHT_BG;
  const cardBackground = LIGHT_CARD;
  const textColor = LIGHT_TEXT;
  const secondaryText = LIGHT_SECONDARY;

  // -------- Helpers --------
  const clearTimers = () => {
    isStoppingRef.current = false;
    if (durationInterval.current) clearInterval(durationInterval.current);
    durationInterval.current = null;
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = null;
  };

  const cleanupWebRecorder = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch { }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
    }
    mediaStreamRef.current = null;

    audioChunksRef.current = [];

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimers();
      cleanupWebRecorder();
    };
  }, []);

  const validateContext = (ctx: FusionContext) => {
    const errors: string[] = [];

    // Check if fields are filled
    if (!babyAge.trim()) {
      errors.push('Baby age is required');
    } else if (!Number.isFinite(ctx.baby_age_months) || ctx.baby_age_months < 0 || ctx.baby_age_months > 36) {
      errors.push('Baby age must be between 0-36 months');
    }

    if (!feedingTime.trim()) {
      errors.push('Time since last feeding is required');
    } else if (!Number.isFinite(ctx.time_since_feed_hours) || ctx.time_since_feed_hours < 0 || ctx.time_since_feed_hours > 48) {
      errors.push('Time since last feeding must be between 0-48 hours');
    }

    if (!sleepTime.trim()) {
      errors.push('Time since last sleep is required');
    } else if (!Number.isFinite(ctx.time_since_sleep_hours) || ctx.time_since_sleep_hours < 0 || ctx.time_since_sleep_hours > 48) {
      errors.push('Time since last sleep must be between 0-48 hours');
    }

    if (!['Clean', 'Wet', 'Soiled'].includes(ctx.diaper_status)) {
      errors.push('Diaper status must be Clean/Wet/Soiled');
    }

    if (!roomTemperature.trim()) {
      errors.push('Room temperature is required');
    } else if (!Number.isFinite(ctx.room_temperature_celsius) || ctx.room_temperature_celsius < 15 || ctx.room_temperature_celsius > 35) {
      errors.push('Room temperature must be between 15-35°C');
    }

    return errors;
  };

  const mapAudioLabel = (label?: string) => {
    const n = (label || '').toLowerCase();
    if (n === 'pain_cry') return 'Pain';
    if (n === 'hunger_cry') return 'Hunger';
    if (n === 'normal_cry') return 'Normal';
    return 'Unknown';
  };

  const mapFaceLabel = (label?: string) => {
    const n = (label || '').toLowerCase();
    if (n === 'pain_expression') return 'Pain';
    if (n === 'no_pain' || n === 'no-pain') return 'No-Pain';
    return 'Unknown';
  };

  const to01 = (v: any) => {
    const num = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(num)) return 0;
    return num > 1 ? num / 100 : num;
  };

  // -------- Recording (Native + Web) --------
  const startRecording = async () => {
    try {
      // reset
      isStoppingRef.current = false;
      setAnalysisResult(null);
      setAudioUri(null);
      setAudioBlob(null);
      clearTimers();

      setIsRecording(true);
      setRecordingDuration(0);

      durationInterval.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Web path
      if (Platform.OS === 'web') {
        cleanupWebRecorder();

        const navAny = navigator as any;
        if (!navAny?.mediaDevices?.getUserMedia) {
          setIsRecording(false);
          clearTimers();
          Alert.alert('Web not supported', 'Your browser does not support audio recording.');
          return;
        }

        // Check permission status before requesting (if API available)
        try {
          if (navigator.permissions?.query) {
            const permStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (permStatus.state === 'denied') {
              setIsRecording(false);
              clearTimers();
              Alert.alert(
                'Microphone Blocked',
                'Microphone access is blocked by your browser or system.\n\n' +
                '1. Click the lock/info icon in the address bar\n' +
                '2. Set Microphone to "Allow"\n' +
                '3. Also check: Windows Settings → Privacy → Microphone → Allow apps to access your microphone\n' +
                '4. Reload the page and try again'
              );
              return;
            }
          }
        } catch (_permCheckErr) {
          // permissions.query may not support 'microphone' in all browsers — continue anyway
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micError: any) {
          setIsRecording(false);
          clearTimers();
          const errName = micError?.name || '';
          if (errName === 'NotAllowedError') {
            Alert.alert(
              'Microphone Permission Denied',
              'The browser or your system blocked microphone access.\n\n' +
              'To fix this:\n' +
              '1. Click the lock/site-info icon in the address bar → set Microphone to "Allow"\n' +
              '2. Check Windows Settings → Privacy & Security → Microphone → ensure "Let apps access your microphone" is ON and your browser is allowed\n' +
              '3. Reload the page and try again'
            );
          } else if (errName === 'NotFoundError') {
            Alert.alert('No Microphone', 'No microphone device was found. Please connect a microphone and try again.');
          } else {
            Alert.alert('Microphone Error', micError?.message || 'Failed to access microphone.');
          }
          return;
        }
        mediaStreamRef.current = stream;

        // Try to pick a decent mimeType; browser will fallback if unsupported.
        const possibleTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/ogg',
        ];
        let mimeType = '';
        for (const t of possibleTypes) {
          if ((window as any).MediaRecorder?.isTypeSupported?.(t)) {
            mimeType = t;
            break;
          }
        }

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          setAudioBlob(blob);

          const url = URL.createObjectURL(blob);
          audioObjectUrlRef.current = url;
          setAudioUri(url);

          setIsRecording(false);
          isStoppingRef.current = false;
          clearTimers();
          Alert.alert('✅ Recording complete', 'Ready to proceed to next step');
        };

        recorder.start();

        // Auto-stop at 5s
        if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = setTimeout(() => {
          stopRecording();
        }, 5000);

        return;
      }

      // Native path
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setIsRecording(false);
        clearTimers();
        Alert.alert('Permission needed', 'Microphone access is required.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;

      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, 5000);

    } catch (error: any) {
      console.error('Recording error:', error);
      setIsRecording(false);
      clearTimers();

      // Catch any permission errors that slipped through
      if (Platform.OS === 'web' && error?.name === 'NotAllowedError') {
        Alert.alert(
          'Microphone Permission Denied',
          'The browser or your system blocked microphone access.\n\n' +
          'To fix this:\n' +
          '1. Click the lock/site-info icon in the address bar → set Microphone to "Allow"\n' +
          '2. Check Windows Settings → Privacy & Security → Microphone → ensure "Let apps access your microphone" is ON\n' +
          '3. Reload the page and try again'
        );
      } else {
        Alert.alert('Error', error?.message || 'Failed to start recording');
      }
    }
  };

  const stopRecording = async () => {
    try {
      if (isStoppingRef.current) return;
      isStoppingRef.current = true;

      // Web stop
      if (Platform.OS === 'web') {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state !== 'inactive') {
          rec.stop(); // triggers onstop -> sets blob + uri
        }
        return;
      }

      // Native stop
      if (!recordingRef.current) return;
      await recordingRef.current.stopAndUnloadAsync();
      const recordedUri = recordingRef.current.getURI();

      recordingRef.current = null;
      setIsRecording(false);
      clearTimers();

      if (!recordedUri) {
        Alert.alert('⚠️ Error', 'Failed to capture recording. URI is null.');
        return;
      }

      setAudioUri(recordedUri);
      Alert.alert('✅ Recording complete', 'Ready to proceed to next step');

    } catch (error: any) {
      console.error('Stop recording error:', error);
      setIsRecording(false);
      clearTimers();
      Alert.alert('Error', error?.message || 'Failed to stop recording');
    }
  };

  // -------- Image capture --------
  const captureImage = async (useCamera: boolean) => {
    try {
      setIsLoading(true);

      if (Platform.OS !== 'web') {
        const permission = useCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (!permission.granted) {
          Alert.alert('Permission needed', useCamera ? 'Camera access is required.' : 'Gallery access is required.');
          setIsLoading(false);
          return;
        }
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });

      if (!result.canceled && result.assets?.[0]) {
        setFaceUri(result.assets[0].uri);
      }
    } catch (error: any) {
      console.error('Image capture error:', error);
      Alert.alert('Error', error?.message || 'Failed to capture image');
    } finally {
      setIsLoading(false);
    }
  };

  // -------- Backend upload helpers --------
  const postFusion = async (payload: Record<string, any>) => {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    let res = await fetch(FUSION_API, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (res.status === 404) {
      res = await fetch(`${BASE_URL}/predict`, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
    return res;
  };

  const uploadAudio = async (): Promise<AudioApiResult | null> => {
    if (!audioUri && !audioBlob) return null;

    try {
      const form = new FormData();

      if (Platform.OS === 'web') {
        if (!audioBlob) throw new Error('Web audio blob missing');
        form.append('file', audioBlob, 'recording.webm');
      } else {
        if (!audioUri) throw new Error('Native audio uri missing');
        form.append('file', { uri: audioUri, name: 'recording.m4a', type: 'audio/m4a' } as any);
      }

      console.log(`📤 Uploading audio to ${AUDIO_API} ...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(AUDIO_API, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const ct = res.headers.get('content-type') || '';
      const json = ct.includes('application/json') ? await res.json() : null;

      if (!res.ok) throw new Error(json?.detail || `Audio request failed (${res.status})`);

      console.log('✅ Audio upload successful:', json);
      
      // Ensure debug_info is included
      if (json && !json.debug_info) {
        console.warn('⚠️ Audio response missing debug_info, adding empty object');
        json.debug_info = {};
      }
      
      return json;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(
          `Request timed out. Make sure your backend is running at ${BASE_URL} and reachable from this device.`
        );
      }
      if (error?.message === 'Network request failed') {
        throw new Error(
          `Cannot reach server at ${BASE_URL}. Ensure:\n` +
          `1. The backend is running\n` +
          `2. Your device is on the same Wi-Fi network\n` +
          `3. EXPO_PUBLIC_API_BASE_URL in .env is set to your computer's local IP (not localhost)`
        );
      }
      console.error('❌ Audio upload error:', error);
      throw error;
    }
  };

  const uploadFace = async (): Promise<FaceApiResult | null> => {
    if (!faceUri) return null;

    try {
      const form = new FormData();

      if (Platform.OS === 'web') {
        const resp = await fetch(faceUri);
        const blob = await resp.blob();
        form.append('file', blob, 'face.jpg');
      } else {
        form.append('file', { uri: faceUri, name: 'face.jpg', type: 'image/jpeg' } as any);
      }

      console.log('📤 Uploading face image...');
      const res = await fetch(FACE_API, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
      });

      const ct = res.headers.get('content-type') || '';
      const json = ct.includes('application/json') ? await res.json() : null;

      if (!res.ok) throw new Error(json?.detail || `Face request failed (${res.status})`);

      console.log('✅ Face upload successful:', json);
      return json;
    } catch (error: any) {
      console.error('❌ Face upload error:', error);
      throw error;
    }
  };

  // -------- Final analysis --------
  const submitAnalysis = async () => {
    setIsLoading(true);

    try {
      if (!audioUri && !audioBlob) {
        Alert.alert('Missing Audio', 'Please record audio first.');
        setIsLoading(false);
        return;
      }
      if (!faceUri) {
        Alert.alert('Missing Photo', 'Please capture a face photo first.');
        setIsLoading(false);
        return;
      }

      const context: FusionContext = {
        baby_age_months: parseFloat(babyAge),
        time_since_feed_hours: parseFloat(feedingTime),
        time_since_sleep_hours: parseFloat(sleepTime),
        diaper_status: diaperStatus,
        room_temperature_celsius: parseFloat(roomTemperature),
      };

      const errors = validateContext(context);
      if (errors.length) {
        Alert.alert('Invalid Input', errors.join('\n'));
        setIsLoading(false);
        return;
      }

      // 1) Call audio + face models
      const [audioRes, faceRes] = await Promise.all([uploadAudio(), uploadFace()]);

      const audioPrediction = audioRes ? mapAudioLabel(audioRes.label) : 'Unknown';
      const audioConfidence = audioRes ? to01(audioRes.confidence) : 0;

      const imagePrediction = faceRes ? mapFaceLabel(faceRes.label) : 'Unknown';
      const imageConfidence = faceRes ? to01(faceRes.confidence) : 0;

      // 2) Fusion payload
      const payload = {
        baby_age_months: context.baby_age_months,
        audio_predicted_class: audioPrediction,
        audio_confidence: audioConfidence,
        image_predicted_class: imagePrediction,
        image_confidence: imageConfidence,
        time_since_feed_hours: context.time_since_feed_hours,
        time_since_sleep_hours: context.time_since_sleep_hours,
        diaper_status: context.diaper_status,
        room_temperature_celsius: context.room_temperature_celsius,
      };

      console.log('📤 Sending fusion payload:', payload);

      const fusionRes = await postFusion(payload);
      const ct = fusionRes.headers.get('content-type') || '';
      const fusionJson: FusionApiResult | null = ct.includes('application/json') ? await fusionRes.json() : null;

      if (!fusionRes.ok) {
        const errorMsg = fusionJson && typeof fusionJson === 'object' ? (fusionJson as any).detail || JSON.stringify(fusionJson) : `HTTP ${fusionRes.status}`;
        throw new Error(`Backend error: ${errorMsg}`);
      }
      if (!fusionJson) throw new Error('Fusion response not JSON');

      const recommendations = getRecommendations(fusionJson.predicted_cry_reason, context);

      const resultData = {
        ...fusionJson,
        recommendations,
        audioPrediction,
        audioConfidence,
        imagePrediction,
        imageConfidence,
        audioModelInputs: audioRes?.debug_info || {},
        imageModelInputs: faceRes?.features || {},
      };

      console.log('📊 Analysis Result:', {
        predictionResult: fusionJson.predicted_cry_reason,
        audioConfidence,
        imageConfidence,
        fusionConfidence: fusionJson.confidence,
        audioModelInputsKeys: Object.keys(resultData.audioModelInputs),
        imageModelInputsKeys: Object.keys(resultData.imageModelInputs),
      });

      setAnalysisResult(resultData);
      setCurrentStep('result');

    } catch (error: any) {
      console.error('❌ Analysis error:', error);

      // Better error message extraction
      let errorMessage = 'Analysis failed';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object' && error.message) {
        errorMessage = error.message;
      }

      Alert.alert('Analysis Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const getRecommendations = (prediction: string, context: FusionContext): string[] => {
    const rec: string[] = [];
    switch ((prediction || '').toLowerCase()) {
      case 'hunger':
        rec.push('Your baby may be hungry');
        rec.push(`Last feeding was ${context.time_since_feed_hours} hours ago`);
        rec.push('Consider offering food or milk');
        break;
      case 'pain':
        rec.push('Your baby may be experiencing discomfort');
        rec.push('Check for signs of illness or injury');
        if (context.diaper_status !== 'Clean') rec.push('Check and change diaper if needed');
        rec.push('If crying continues, consider medical advice');
        break;
      case 'tiredness':
        rec.push('Your baby might be tired');
        rec.push(`Last sleep was ${context.time_since_sleep_hours} hours ago`);
        rec.push('Try soothing and a calm sleep environment');
        break;
      default:
        rec.push('Monitor your baby closely');
        rec.push('Check feeding, diaper, temperature, and comfort');
        break;
    }
    return rec;
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case 'record': return 'Record Cry';
      case 'capture': return 'Capture Face';
      case 'context': return 'Baby Care Info';
      case 'result': return 'Analysis Result';
    }
  };

  const getStepNumber = () => {
    switch (currentStep) {
      case 'record': return '1';
      case 'capture': return '2';
      case 'context': return '3';
      case 'result': return '✓';
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor }]} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.progressContainer}>
          <View style={[styles.stepIndicator, { backgroundColor: Colors.light.primary }]}>
            <ThemedText style={styles.stepNumber}>{getStepNumber()}</ThemedText>
          </View>
          {currentStep !== 'result' && (
            <ThemedText style={[styles.stepInfo, { color: secondaryText }]}>
              Step {getStepNumber()} of 3
            </ThemedText>
          )}
        </View>
        <ThemedText style={[styles.stepTitle, { color: textColor }]}>{getStepTitle()}</ThemedText>
      </View>

      <View style={styles.content}>
        {/* STEP 1: RECORD */}
        {currentStep === 'record' && (
          <View style={[styles.stepCard, { backgroundColor: cardBackground, shadowColor }]}>
            {!audioUri && (
              <>
                <View style={styles.iconContainer}>
                  <View style={[styles.recordIcon, { backgroundColor: isRecording ? Colors.light.error : Colors.light.primary }]}>
                    <ThemedText style={styles.recordIconText}>{isRecording ? '⏺' : '🎤'}</ThemedText>
                  </View>
                </View>

                <ThemedText style={[styles.stepDescription, { color: secondaryText }]}>
                  {isRecording ? 'Recording in progress...' : 'Hold your phone near baby and tap below'}
                </ThemedText>
              </>
            )}

            {isRecording && (
              <View style={styles.recordingIndicator}>
                <ThemedText style={[styles.recordingText, { color: Colors.light.error }]}>
                  Recording... {recordingDuration}s / 5s
                </ThemedText>
                <View style={styles.waveform}>
                  <View style={[styles.waveBar, { backgroundColor: Colors.light.error }]} />
                  <View style={[styles.waveBar, { backgroundColor: Colors.light.error }]} />
                  <View style={[styles.waveBar, { backgroundColor: Colors.light.error }]} />
                </View>
                <ThemedText style={[styles.countdownText, { color: Colors.light.error }]}>
                  Stopping in {Math.max(0, 5 - recordingDuration)}...
                </ThemedText>
              </View>
            )}

            {audioUri && !isRecording && (
              <View style={styles.successContainer}>
                <ThemedText style={[styles.successIcon, { color: Colors.light.success }]}>✓</ThemedText>
                <ThemedText style={[styles.successText, { color: Colors.light.success }]}>
                  Audio recorded successfully
                </ThemedText>
                <ThemedText style={[styles.recordDurationText, { color: secondaryText }]}>
                  {recordingDuration} seconds captured
                </ThemedText>
              </View>
            )}

            {!audioUri && (
              <Pressable
                style={[
                  styles.recordButton,
                  {
                    backgroundColor: isRecording ? Colors.light.error : Colors.light.primary,
                    opacity: isLoading ? 0.7 : 1,
                  },
                ]}
                onPress={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
              >
                {isLoading && isRecording ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <View style={styles.buttonContent}>
                    <ThemedText style={styles.recordButtonText}>
                      {isRecording ? 'Recording... Tap to stop' : 'Tap to Record'}
                    </ThemedText>
                    {!isRecording && (
                      <ThemedText style={styles.recordButtonSubtext}>
                        Auto-stops at 5 seconds
                      </ThemedText>
                    )}
                  </View>
                )}
              </Pressable>
            )}

            {audioUri && !isRecording && (
              <View style={styles.actionButtonsGroup}>
                <Pressable
                  style={[styles.outlineButton, { borderColor: Colors.light.primary }]}
                  onPress={() => {
                    // cleanup old web object URL before re-record
                    if (Platform.OS === 'web' && audioObjectUrlRef.current) {
                      URL.revokeObjectURL(audioObjectUrlRef.current);
                      audioObjectUrlRef.current = null;
                    }
                    setAudioUri(null);
                    setAudioBlob(null);
                    setRecordingDuration(0);
                  }}
                  disabled={isLoading}
                >
                  <ThemedText style={[styles.outlineButtonText, { color: Colors.light.primary }]}>
                    🔄 Record Again
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={[styles.solidButton, { backgroundColor: Colors.light.primary }]}
                  onPress={() => setCurrentStep('capture')}
                  disabled={isLoading}
                >
                  <ThemedText style={styles.solidButtonText}>
                    Next: Capture Face →
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* STEP 2: CAPTURE */}
        {currentStep === 'capture' && (
          <View style={[styles.stepCard, { backgroundColor: cardBackground, shadowColor }]}>
            {faceUri ? (
              <View style={styles.imagePreview}>
                <Image source={{ uri: faceUri }} style={styles.previewImage} />
                <ThemedText style={[styles.successText, { color: Colors.light.success }]}>
                  ✓ Photo captured successfully
                </ThemedText>

                <View style={styles.actionButtons}>
                  <Pressable
                    style={[styles.secondaryButton, { backgroundColor: Colors.light.primary }]}
                    onPress={() => setFaceUri(null)}
                  >
                    <ThemedText style={styles.buttonText}>🔄 Retake Photo</ThemedText>
                  </Pressable>

                  <Pressable
                    style={[styles.secondaryButton, { backgroundColor: Colors.light.success }]}
                    onPress={() => setCurrentStep('context')}
                  >
                    <ThemedText style={styles.buttonText}>Continue →</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.iconContainer}>
                  <View style={[styles.recordIcon, { backgroundColor: Colors.light.accent }]}>
                    <ThemedText style={styles.recordIconText}>📸</ThemedText>
                  </View>
                </View>

                <ThemedText style={[styles.stepDescription, { color: secondaryText }]}>
                  Take or choose a clear photo of your baby's face
                </ThemedText>

                <View style={styles.buttonRow}>
                  <Pressable
                    style={[styles.secondaryButton, { backgroundColor: Colors.light.accent }]}
                    onPress={() => captureImage(true)}
                    disabled={isLoading}
                  >
                    <ThemedText style={styles.buttonText}>Take Photo</ThemedText>
                  </Pressable>

                  <Pressable
                    style={[styles.secondaryButton, { backgroundColor: Colors.light.warning }]}
                    onPress={() => captureImage(false)}
                    disabled={isLoading}
                  >
                    <ThemedText style={styles.buttonText}>Choose Photo</ThemedText>
                  </Pressable>
                </View>
              </>
            )}

            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            )}
          </View>
        )}

        {/* STEP 3: CONTEXT */}
        {currentStep === 'context' && (
          <View style={[styles.stepCard, { backgroundColor: cardBackground, shadowColor }]}>
            <ThemedText style={[styles.stepDescription, { color: secondaryText }]}>
              Share a few care details to improve the result
            </ThemedText>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: textColor }]}>Baby's age (months)</ThemedText>
              <TextInput
                style={[styles.textInput, { borderColor: Colors.light.border, color: textColor }]}
                value={babyAge}
                onChangeText={setBabyAge}
                placeholder="3"
                placeholderTextColor={secondaryText}
                keyboardType="numeric"
              />
              <ThemedText style={[styles.inputHint, { color: secondaryText }]}>Valid range: 0-36 months</ThemedText>
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: textColor }]}>Time since last feeding (hours)</ThemedText>
              <TextInput
                style={[styles.textInput, { borderColor: Colors.light.border, color: textColor }]}
                value={feedingTime}
                onChangeText={setFeedingTime}
                placeholder="2"
                placeholderTextColor={secondaryText}
                keyboardType="numeric"
              />
              <ThemedText style={[styles.inputHint, { color: secondaryText }]}>Valid range: 0-48 hours</ThemedText>
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: textColor }]}>Time since last sleep (hours)</ThemedText>
              <TextInput
                style={[styles.textInput, { borderColor: Colors.light.border, color: textColor }]}
                value={sleepTime}
                onChangeText={setSleepTime}
                placeholder="1"
                placeholderTextColor={secondaryText}
                keyboardType="numeric"
              />
              <ThemedText style={[styles.inputHint, { color: secondaryText }]}>Valid range: 0-48 hours</ThemedText>
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: textColor }]}>Diaper status</ThemedText>
              <View style={styles.radioContainer}>
                {['Clean', 'Wet', 'Soiled'].map(status => (
                  <Pressable
                    key={status}
                    style={[
                      styles.radioOption,
                      diaperStatus === status && styles.radioSelected,
                      diaperStatus === status && { borderColor: Colors.light.primary },
                    ]}
                    onPress={() => setDiaperStatus(status)}
                  >
                    <ThemedText style={[styles.radioText, { color: textColor }]}>
                      {status}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: textColor }]}>Room temperature (°C)</ThemedText>
              <TextInput
                style={[styles.textInput, { borderColor: Colors.light.border, color: textColor }]}
                value={roomTemperature}
                onChangeText={setRoomTemperature}
                placeholder="24"
                placeholderTextColor={secondaryText}
                keyboardType="numeric"
              />
              <ThemedText style={[styles.inputHint, { color: secondaryText }]}>Valid range: 15-35°C</ThemedText>
            </View>

            <View style={styles.actionButtons}>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: Colors.light.primary }]}
                onPress={submitAnalysis}
                disabled={isLoading}
              >
                {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.buttonText}>Analyze</ThemedText>}
              </Pressable>
            </View>
          </View>
        )}

        {/* RESULT */}
        {currentStep === 'result' && analysisResult && (
          <View style={[styles.stepCard, { backgroundColor: cardBackground, shadowColor, shadowOpacity: 0.05, shadowRadius: 10 }]}>
            <View style={styles.resultHeader}>
              <View style={[styles.resultIcon, { backgroundColor: '#F0FFFE' }]}>
                <ThemedText style={styles.resultIconText}>
                  {analysisResult.predicted_cry_reason === 'Pain' ? '😟' :
                    analysisResult.predicted_cry_reason === 'Hunger' ? '🍼' :
                      analysisResult.predicted_cry_reason === 'Discomfort' ? '😤' : '😴'}
                </ThemedText>
              </View>

              <ThemedText style={[styles.resultTitle, { color: textColor }]}>
                {analysisResult.predicted_cry_reason}
              </ThemedText>

              {analysisResult.confidence_message && (
                <ThemedText style={[styles.confidenceMessage, { color: secondaryText }]}>
                  {analysisResult.confidence_message}
                </ThemedText>
              )}

              <View style={styles.confidenceContainer}>
                <View style={[styles.confidenceBar, { backgroundColor: Colors.light.border }]}>
                  <View style={[styles.confidenceFill, {
                    backgroundColor: (analysisResult.confidence ?? 0) > 0.8 ? Colors.light.success :
                      (analysisResult.confidence ?? 0) > 0.6 ? Colors.light.warning : Colors.light.error,
                    width: `${Math.round((analysisResult.confidence ?? 0) * 100)}%`,
                  }]} />
                </View>
                <ThemedText style={[styles.confidenceText, { color: secondaryText }]}>
                  {Math.round((analysisResult.confidence ?? 0) * 100)}% Confidence Score
                </ThemedText>
              </View>
            </View>

            {/* Individual Model Results */}
            <View style={[styles.modelResultsContainer]}>
              <View style={[styles.modelResultCard, { backgroundColor: '#F0F9FF', borderLeftColor: '#3B82F6' }]}>
                <View style={styles.modelResultHeader}>
                  <ThemedText style={styles.modelResultIcon}>🎙️</ThemedText>
                  <ThemedText style={[styles.modelResultTitle, { color: textColor }]}>Audio Model</ThemedText>
                </View>
                <ThemedText style={[styles.modelResultLabel, { color: textColor }]}>
                  {analysisResult.audioPrediction || 'Unknown'}
                </ThemedText>
                <View style={styles.modelConfidenceRow}>
                  <View style={[styles.modelConfidenceBar, { backgroundColor: '#E5E7EB' }]}>
                    <View style={[styles.modelConfidenceFill, {
                      width: `${Math.round((analysisResult.audioConfidence ?? 0) * 100)}%`,
                      backgroundColor: '#3B82F6'
                    }]} />
                  </View>
                  <ThemedText style={[styles.modelConfidenceText, { color: secondaryText }]}>
                    {Math.round((analysisResult.audioConfidence ?? 0) * 100)}%
                  </ThemedText>
                </View>
              </View>

              <View style={[styles.modelResultCard, { backgroundColor: '#FEF3F2', borderLeftColor: '#EF4444' }]}>
                <View style={styles.modelResultHeader}>
                  <ThemedText style={styles.modelResultIcon}>📷</ThemedText>
                  <ThemedText style={[styles.modelResultTitle, { color: textColor }]}>Image Model</ThemedText>
                </View>
                <ThemedText style={[styles.modelResultLabel, { color: textColor }]}>
                  {analysisResult.imagePrediction || 'Unknown'}
                </ThemedText>
                <View style={styles.modelConfidenceRow}>
                  <View style={[styles.modelConfidenceBar, { backgroundColor: '#E5E7EB' }]}>
                    <View style={[styles.modelConfidenceFill, {
                      width: `${Math.round((analysisResult.imageConfidence ?? 0) * 100)}%`,
                      backgroundColor: '#EF4444'
                    }]} />
                  </View>
                  <ThemedText style={[styles.modelConfidenceText, { color: secondaryText }]}>
                    {Math.round((analysisResult.imageConfidence ?? 0) * 100)}%
                  </ThemedText>
                </View>
              </View>
            </View>

            {analysisResult.all_class_probabilities && (
              <View style={[styles.insightCard, { backgroundColor: Colors.light.background, borderLeftColor: Colors.light.accent }]}>
                <ThemedText style={[styles.insightTitle, { color: textColor }]}>Probability Breakdown</ThemedText>
                <View style={styles.probabilityTable}>
                  {Object.entries(analysisResult.all_class_probabilities).map(([reason, prob]: [string, any]) => (
                    <View key={reason} style={styles.probabilityRow}>
                      <ThemedText style={[styles.probabilityLabel, { color: textColor }]} numberOfLines={1}>
                        {reason}
                      </ThemedText>
                      <View style={[styles.probabilityBarSmall, { backgroundColor: Colors.light.border }]}>
                        <View style={[styles.probabilityFillSmall, {
                          width: `${Math.round((prob ?? 0) * 100)}%`,
                          backgroundColor: (prob ?? 0) > 0.4 ? Colors.light.primary : Colors.light.warning
                        }]} />
                      </View>
                      <ThemedText style={[styles.probabilityValue, { color: secondaryText }]}>
                        {Math.round((prob ?? 0) * 100)}%
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={[styles.insightCard, { backgroundColor: cardBackground, borderLeftColor: Colors.light.primary }]}>
              <ThemedText style={[styles.insightTitle, { color: textColor }]}>Recommendations</ThemedText>
              <ThemedText style={[styles.insightText, { color: secondaryText }]}>
                {analysisResult.recommendations.map(r => `• ${r}`).join('\n')}
              </ThemedText>
            </View>

            {analysisResult.disclaimer && (
              <View style={[styles.disclaimerCard, { backgroundColor: 'rgba(255, 179, 71, 0.1)', borderLeftColor: Colors.light.warning }]}>
                <ThemedText style={[styles.disclaimerText, { color: secondaryText }]}>
                  {analysisResult.disclaimer}
                </ThemedText>
              </View>
            )}

            <View style={styles.actionButtons}>
              <Pressable
                style={[styles.analyzeAgainButton, { borderColor: Colors.light.primary }]}
                onPress={() => {
                  setCurrentStep('record');
                  setAudioUri(null);
                  setAudioBlob(null);
                  setFaceUri(null);
                  setAnalysisResult(null);
                  setBabyAge('');
                  setFeedingTime('');
                  setSleepTime('');
                  setRoomTemperature('');
                  setRecordingDuration(0);
                }}
              >
                <ThemedText style={[styles.analyzeAgainText, { color: Colors.light.primary }]}>🔄 Analyze Again</ThemedText>
              </Pressable>

              <Pressable
                style={[styles.doneButton, { backgroundColor: Colors.light.primary, shadowColor, shadowOpacity: 0.1, shadowRadius: 8 }]}
                onPress={() => setShowFeedback(true)}
              >
                <ThemedText style={styles.doneButtonText}>✓ Done</ThemedText>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Feedback Modal */}
      <FeedbackModal
        visible={showFeedback}
        onClose={() => {
          setShowFeedback(false);
          router.push('/');
        }}
        onSubmit={async (rating, comment) => {
          const FEEDBACK_API = `${BASE_URL}/feedback`;
          const body = {
            predictionResult: analysisResult?.predicted_cry_reason || 'Unknown',
            audioModelScore: analysisResult?.audioConfidence ?? 0,
            imageModelScore: analysisResult?.imageConfidence ?? 0,
            fusionModelScore: analysisResult?.confidence ?? 0,
            audioModelInputs: analysisResult?.audioModelInputs || {},
            imageModelInputs: analysisResult?.imageModelInputs || {},
            allClassProbabilities: analysisResult?.all_class_probabilities || {},
            contextInputs: {
              baby_age_months: parseFloat(babyAge) || 0,
              time_since_feed_hours: parseFloat(feedingTime) || 0,
              time_since_sleep_hours: parseFloat(sleepTime) || 0,
              diaper_status: diaperStatus,
              room_temperature_celsius: parseFloat(roomTemperature) || 0,
            },
            userRating: rating,
            userComment: comment,
          };
          
          console.log('📤 Submitting feedback with audioModelInputs:', body.audioModelInputs);
          
          const res = await fetch(FEEDBACK_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          });
          
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.detail || 'Failed to submit feedback');
          }
          
          console.log('✅ Feedback submitted successfully');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Spacing.xl },
  scrollContent: { flexGrow: 1, paddingBottom: Spacing.xl * 2 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, alignItems: 'center' },
  progressContainer: { alignItems: 'center', marginBottom: Spacing.lg },
  stepIndicator: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  stepNumber: { color: '#FFFFFF', fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold },
  stepInfo: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium },
  stepTitle: { fontSize: Typography.sizes.xxl, fontWeight: Typography.weights.bold, textAlign: 'center' },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
  stepCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    width: '100%',
    alignItems: 'center',
  },
  iconContainer: { marginBottom: Spacing.xl },
  recordIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  recordIconText: { fontSize: 32 },
  stepDescription: { fontSize: Typography.sizes.md, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xl },
  recordingIndicator: { alignItems: 'center', marginBottom: Spacing.xl },
  recordingText: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.semiBold, marginBottom: Spacing.md },
  waveform: { flexDirection: 'row', gap: 4 },
  waveBar: { width: 4, height: 20, borderRadius: 2 },
  countdownText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, marginTop: Spacing.sm },
  primaryButton: {
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 200,
  },
  secondaryButton: {
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  buttonText: { color: '#FFFFFF', fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold },
  recordButton: {
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: Spacing.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonContent: { alignItems: 'center' },
  recordButtonText: { color: '#FFFFFF', fontSize: Typography.sizes.lg, fontWeight: Typography.weights.semiBold },
  recordButtonSubtext: { color: 'rgba(255, 255, 255, 0.7)', fontSize: Typography.sizes.sm, marginTop: Spacing.xs },
  successIcon: { fontSize: 40, marginBottom: Spacing.sm },
  successText: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.medium },
  recordDurationText: { fontSize: Typography.sizes.sm, marginTop: Spacing.sm },
  actionButtonsGroup: { flexDirection: 'row', gap: Spacing.md, width: '100%', marginTop: Spacing.xl },
  outlineButton: {
    flex: 1,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  outlineButtonText: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold },
  solidButton: {
    flex: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  solidButtonText: { color: '#FFFFFF', fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold },
  buttonRow: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  imagePreview: { alignItems: 'center', width: '100%' },
  previewImage: { width: 200, height: 200, borderRadius: BorderRadius.lg, marginBottom: Spacing.lg },
  inputContainer: { width: '100%', marginBottom: Spacing.xl, paddingBottom: Spacing.sm },
  inputLabel: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, marginBottom: Spacing.sm },
  textInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.sizes.md,
  },
  inputHint: { fontSize: Typography.sizes.xs, marginTop: Spacing.xs, fontStyle: 'italic' },
  resultHeader: { alignItems: 'center', marginBottom: Spacing.xl, width: '100%' },
  resultIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  resultIconText: { fontSize: 24 },
  resultTitle: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, marginBottom: Spacing.lg, textAlign: 'center' },
  confidenceContainer: { width: '100%', alignItems: 'center' },
  confidenceBar: { width: '100%', height: 8, borderRadius: 4, marginBottom: Spacing.sm },
  confidenceFill: { height: '100%', borderRadius: 4 },
  confidenceText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium },
  modelResultsContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
    marginBottom: Spacing.xl,
  },
  modelResultCard: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
  },
  modelResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  modelResultIcon: {
    fontSize: 16,
    marginRight: Spacing.xs,
  },
  modelResultTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
  },
  modelResultLabel: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    marginBottom: Spacing.sm,
  },
  modelConfidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  modelConfidenceBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  modelConfidenceFill: {
    height: '100%',
    borderRadius: 3,
  },
  modelConfidenceText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
    minWidth: 35,
    textAlign: 'right',
  },
  insightCard: {
    width: '100%',
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 4,
    marginBottom: Spacing.xl,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 10,
    elevation: 2,
  },
  insightTitle: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold, marginBottom: Spacing.sm },
  insightText: { fontSize: Typography.sizes.sm, lineHeight: 20 },
  actionButtons: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  successContainer: {
    width: '100%',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: 'rgba(78, 205, 196, 0.1)',
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginBottom: Spacing.lg,
    marginTop: Spacing.lg,
  },
  radioContainer: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'space-between', width: '100%' },
  radioOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '32%',
  },
  radioSelected: { backgroundColor: 'rgba(78, 205, 196, 0.15)' },
  radioText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, textAlign: 'center' },
  confidenceMessage: { fontSize: Typography.sizes.sm, fontStyle: 'italic', marginVertical: Spacing.md, textAlign: 'center' },
  probabilityTable: { width: '100%' },
  probabilityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md, gap: Spacing.sm },
  probabilityLabel: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, flex: 1, maxWidth: 100 },
  probabilityBarSmall: { flex: 2, height: 6, borderRadius: 3, backgroundColor: Colors.light.border },
  probabilityFillSmall: { height: '100%', borderRadius: 3 },
  probabilityValue: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, minWidth: 45, textAlign: 'right' },
  disclaimerCard: { width: '100%', padding: Spacing.lg, borderRadius: BorderRadius.lg, borderLeftWidth: 4, marginBottom: Spacing.xl },
  disclaimerText: { fontSize: Typography.sizes.xs, lineHeight: 18, fontStyle: 'italic' },
  analyzeAgainButton: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  analyzeAgainText: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold },
  doneButton: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  doneButtonText: { color: '#FFFFFF', fontSize: Typography.sizes.md, fontWeight: Typography.weights.semiBold },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: BorderRadius.lg,
  },
});