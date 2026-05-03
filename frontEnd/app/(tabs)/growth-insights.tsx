import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Colors, Spacing, Radius, Shadows } from '@/constants/theme';

const C = Colors.light;
const API_URL = Platform.OS === 'web'
  ? 'http://127.0.0.1:9000/api'
  : 'http://192.168.8.119:9000/api';

/* ── Helpers ── */
const RISK_COLORS = {
  high:   { fg: '#EF4444', soft: '#FEE2E2' },
  medium: { fg: '#F59E0B', soft: '#FEF3C7' },
  low:    { fg: '#22C55E', soft: '#DCFCE7' },
  none:   { fg: C.labelTertiary, soft: C.cardSecondary },
};

function getRiskColor(level: string | null) {
  if (level === 'High')   return RISK_COLORS.high.fg;
  if (level === 'Medium') return RISK_COLORS.medium.fg;
  if (level === 'Low')    return RISK_COLORS.low.fg;
  return RISK_COLORS.none.fg;
}

function getAnomalyColor(label: string | null) {
  if (label === 'critical')   return '#EF4444';
  if (label === 'anomaly')    return '#F97316';
  if (label === 'monitoring') return '#F59E0B';
  return '#22C55E';
}

export default function GrowthInsightsScreen() {
  const router  = useRouter();
  const { user } = useAuth();

  const [infant, setInfant]               = useState<any>(null);
  const [riskScore, setRiskScore]         = useState<number | null>(null);
  const [riskLevel, setRiskLevel]         = useState<string | null>(null);
  const [anomalyData, setAnomalyData]     = useState<any>(null);
  const [pageLoading, setPageLoading]     = useState(true);
  const [anomalyLoading, setAnomalyLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) { setPageLoading(false); return; }
      try {
        const { data: infantData } = await supabase
          .from('infants').select('*').eq('parent_id', user.id).maybeSingle();
        if (!infantData) { setPageLoading(false); return; }
        setInfant(infantData);

        const dashRes = await fetch(`${API_URL}/growth/dashboard/${infantData.id}`);
        if (!dashRes.ok) throw new Error('Dashboard API failed');
        const dashData = await dashRes.json();

        setRiskScore(dashData.risk_score ?? null);
        setRiskLevel(dashData.risk_level ?? null);

        setAnomalyLoading(true);
        const { data: log } = await supabase.from('daily_logs')
          .select('*').eq('infant_id', infantData.id)
          .order('log_date', { ascending: false }).limit(1).maybeSingle();

        if (log) {
          let weightVelocity = 0;
          if (dashData.chart_data?.length >= 2) {
            const m = dashData.chart_data;
            const latest = m[m.length - 1], prev = m[m.length - 2];
            const daysDiff = (new Date(latest.measured_date).getTime() - new Date(prev.measured_date).getTime()) / 86400000;
            if (daysDiff > 0) weightVelocity = (latest.weight_g - prev.weight_g) / daysDiff;
          }
          const anomalyRes = await fetch(`${API_URL}/growth/anomaly-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              age_in_days: dashData.age_days ?? 0,
              weight_g: dashData.latest_weight_g ?? 3500,
              height_cm: dashData.latest_height_cm ?? 50,
              waz_score: dashData.current_waz ?? 0,
              illness_day: log.has_illness ? 1 : 0,
              recovery_day: log.recovery_day ?? 0,
              has_illness_episode: log.has_illness ? 1 : 0,
              sleep_hours: log.sleep_hours ?? 16,
              feeding_frequency: log.feeding_frequency ?? 8,
              daily_calorie_intake: log.daily_calorie_intake ?? 0,
              appetite_factor: log.has_illness ? 0.6 : 1.0,
              gestational_diabetes: infantData.gestational_diabetes ? 1 : 0,
              maternal_bmi: infantData.maternal_bmi ?? 22,
              weight_velocity: weightVelocity,
              f_solid_meal: log.f_solid_meal ?? 0,
              f_nutritious_snacks: log.f_nutritious_snacks ?? 0,
              underweight_flag: (dashData.current_waz ?? 0) < -2 ? 1 : 0,
              severe_underweight_flag: (dashData.current_waz ?? 0) < -3 ? 1 : 0,
            }),
          });
          if (anomalyRes.ok) setAnomalyData(await anomalyRes.json());
        }
      } catch (err) {
        console.error('Growth Insights fetch error:', err);
      } finally {
        setPageLoading(false);
        setAnomalyLoading(false);
      }
    };
    fetchData();
  }, [user]);

  const alertMatrix = useMemo(() => {
    const rs = riskScore ?? 0;
    const as = anomalyData?.ensemble_anomaly_score ?? 0;
    if (rs >= 0.5 && as >= 0.5) return {
      text: '🔴 Needs Attention',
      color: '#EF4444', soft: '#FEE2E2',
      desc: 'Both present and future signals are elevated. Please speak to your doctor soon.',
    };
    if (rs >= 0.5 && as < 0.5) return {
      text: '🟡 Worth Watching',
      color: '#F59E0B', soft: '#FEF3C7',
      desc: 'Risk is rising over the next 7 days, but no current-state concern detected yet. Keep logging daily.',
    };
    if (rs < 0.5 && as >= 0.5) return {
      text: '🟠 Something\'s Different Today',
      color: '#F97316', soft: '#FFEDD5',
      desc: 'Something unusual is happening right now — possibly illness or a temporary change. Future outlook is still fine.',
    };
    return {
      text: '🟢 All Clear',
      color: '#22C55E', soft: '#DCFCE7',
      desc: 'Everything looks good. Your baby\'s growth is on track.',
    };
  }, [riskScore, anomalyData]);

  const riskColor        = useMemo(() => getRiskColor(riskLevel), [riskLevel]);
  const anomalyLabelColor = useMemo(() => getAnomalyColor(anomalyData?.anomaly_label ?? null), [anomalyData]);

  if (pageLoading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={C.primary} /></View>;
  }
  if (!infant) {
    return (
      <View style={s.centered}>
        <Text style={{ fontSize: 15, color: C.labelSecondary }}>Add a baby profile to see insights</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

      {/* ── TEAL HEADER ── */}
      <LinearGradient
        colors={[C.primary, '#4A8F98']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.hero}
      >
        <SafeAreaView edges={['top']}>
          <View style={s.heroTop}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <ChevronLeft size={20} color="rgba(255,255,255,0.9)" strokeWidth={2} />
              <Text style={s.backText}>Back</Text>
            </Pressable>
            <View style={s.heroTitleBlock}>
              <Text style={s.heroTitle}>Growth Insights</Text>
              <Text style={s.heroSub}>{infant.name} · AI Analysis</Text>
            </View>
            <View style={{ width: 60 }} />
          </View>

          {/* Status pill */}
          <View style={s.statusPillWrap}>
            <View style={[s.statusPill, { backgroundColor: alertMatrix.soft }]}>
              <Text style={[s.statusPillText, { color: alertMatrix.color }]}>{alertMatrix.text}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={s.body}>

        {/* ── TODAY'S SIGNAL ── */}
        <Text style={s.sectionTitle}>Today's Signal</Text>
        <View style={s.scoreRow}>
          {/* 7-Day Risk */}
          <View style={[s.scoreCard, { borderLeftColor: riskColor }, Shadows.sm]}>
            <Text style={s.scoreEmoji}>🔮</Text>
            <Text style={s.scoreCardLabel}>7-Day Risk</Text>
            <Text style={[s.scoreValue, { color: riskColor }]}>
              {riskScore !== null ? `${Math.round(riskScore * 100)}%` : '--'}
            </Text>
            <Text style={[s.scoreStatus, { color: riskColor }]}>{riskLevel || 'Checking…'}</Text>
            <Text style={s.scoreHint}>Next 7 days outlook</Text>
          </View>

          {/* Today's State */}
          <View style={[s.scoreCard, { borderLeftColor: anomalyLabelColor }, Shadows.sm]}>
            <Text style={s.scoreEmoji}>🎯</Text>
            <Text style={s.scoreCardLabel}>Today's State</Text>
            <Text style={[s.scoreValue, { color: anomalyLabelColor }]}>
              {anomalyData?.ensemble_anomaly_score !== undefined
                ? `${Math.round(anomalyData.ensemble_anomaly_score * 100)}%`
                : '--'}
            </Text>
            <Text style={[s.scoreStatus, { color: anomalyLabelColor }]}>
              {anomalyData?.anomaly_label
                ? anomalyData.anomaly_label.charAt(0).toUpperCase() + anomalyData.anomaly_label.slice(1)
                : (anomalyLoading ? 'Analyzing…' : 'Unavailable')}
            </Text>
            <Text style={s.scoreHint}>
              {anomalyData ? 'Present-state signal' : 'Anomaly engine offline'}
            </Text>
          </View>
        </View>

        {/* ── WHAT THIS MEANS ── */}
        <View style={[s.explanationCard, { backgroundColor: alertMatrix.soft }]}>
          <Text style={[s.explanationTitle, { color: alertMatrix.color }]}>{alertMatrix.text}</Text>
          <Text style={[s.explanationDesc, { color: alertMatrix.color }]}>{alertMatrix.desc}</Text>
        </View>

        {/* ── MODEL CONFIDENCE ── */}
        <Text style={s.sectionTitle}>Model Confidence</Text>
        <View style={[s.confidenceCard, Shadows.sm]}>
          <View style={s.confidenceHeader}>
            <Text style={s.confidenceTitle}>Anomaly Engines</Text>
            <View style={[s.confidenceBadge, {
              backgroundColor: anomalyData?.confidence === 'high'
                ? '#DCFCE7' : (anomalyData ? '#FEF3C7' : C.cardSecondary),
            }]}>
              <Text style={[s.confidenceBadgeText, {
                color: anomalyData?.confidence === 'high'
                  ? '#22C55E' : (anomalyData ? '#F59E0B' : C.labelTertiary),
              }]}>
                {anomalyData?.confidence
                  ? anomalyData.confidence.toUpperCase()
                  : (anomalyLoading ? 'PENDING' : 'OFFLINE')}
              </Text>
            </View>
          </View>

          <BarRow
            label="Random Forest"
            pct={(anomalyData?.rf_anomaly_score || 0) * 100}
            color={C.primary}
          />
          <BarRow
            label="XGBoost"
            pct={(anomalyData?.xgb_anomaly_score || 0) * 100}
            color="#4A8F98"
          />
        </View>

        {/* ── CONDITIONAL BANNERS ── */}
        {anomalyData?.recovery_signal && (
          <View style={[s.banner, { backgroundColor: C.successSoft, borderColor: C.success }]}>
            <Text style={{ fontSize: 16 }}>📈</Text>
            <Text style={[s.bannerText, { color: C.success }]}>
              Recovery pattern detected — your baby appears to be getting better
            </Text>
          </View>
        )}
        {anomalyData?.gdm_sensitive && (
          <View style={[s.banner, { backgroundColor: C.warningSoft, borderColor: C.warning }]}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
            <Text style={[s.bannerText, { color: C.warning }]}>
              Higher sensitivity active — gestational diabetes history is factored in
            </Text>
          </View>
        )}

        {/* ── HOW IT WORKS ── */}
        <View style={s.infoBox}>
          <Text style={s.infoText}>
            🔮 7-Day Risk — trained on 33,000 infant records to predict underweight risk in the next 7 days.
          </Text>
          <Text style={[s.infoText, { marginTop: 8 }]}>
            🎯 Today's State — detects if your baby is currently below their personal growth baseline.
          </Text>
          <Text style={s.infoFooter}>Scores update each time you log daily data.</Text>
        </View>

        {/* ── ACTIONS ── */}
        <View style={s.actionsRow}>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(tabs)/daily-log')}
          >
            <Text style={s.primaryBtnText}>📋  Log Today</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.outlineBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.push('/(tabs)/update-measurements' as any)}
          >
            <Text style={s.outlineBtnText}>⚖️  Update Weight</Text>
          </Pressable>
        </View>

        <View style={{ height: 60 }} />
      </View>
    </ScrollView>
  );
}

function BarRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <View style={s.barItem}>
      <View style={s.barLabelRow}>
        <Text style={s.barLabel}>{label}</Text>
        <Text style={s.barPct}>{Math.round(pct)}%</Text>
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },

  /* Hero */
  hero: {
    paddingHorizontal: Spacing.screenPadding,
    paddingBottom: 28,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  heroTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 8 : 16, marginBottom: 16,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 6 },
  backText: { fontSize: 15, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  heroTitleBlock: { alignItems: 'center' },
  heroTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statusPillWrap: { alignItems: 'center', marginBottom: 4 },
  statusPill: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: Radius.full, ...Shadows.md },
  statusPillText: { fontSize: 15, fontWeight: '700' },

  /* Body */
  body: { paddingHorizontal: Spacing.screenPadding, paddingTop: Spacing.xl },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: C.label,
    letterSpacing: -0.2, marginBottom: Spacing.md, marginTop: 4,
  },

  /* Score cards */
  scoreRow: { flexDirection: 'row', gap: 12, marginBottom: Spacing.lg },
  scoreCard: {
    flex: 1, backgroundColor: C.card, borderRadius: Radius.xl,
    padding: Spacing.lg, borderLeftWidth: 4, gap: 4,
  },
  scoreEmoji: { fontSize: 22, marginBottom: 4 },
  scoreCardLabel: { fontSize: 10, color: C.labelTertiary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreValue: { fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  scoreStatus: { fontSize: 12, fontWeight: '700' },
  scoreHint: { fontSize: 10, color: C.labelTertiary, marginTop: 4 },

  /* Explanation */
  explanationCard: { padding: Spacing.lg, borderRadius: Radius.xl, marginBottom: Spacing.xl },
  explanationTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  explanationDesc: { fontSize: 13, lineHeight: 20 },

  /* Confidence */
  confidenceCard: { backgroundColor: C.card, padding: Spacing.lg, borderRadius: Radius.xl, marginBottom: Spacing.xl },
  confidenceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  confidenceTitle: { fontSize: 15, fontWeight: '700', color: C.label },
  confidenceBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  confidenceBadgeText: { fontSize: 11, fontWeight: '700' },
  barItem: { marginBottom: 14 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { fontSize: 12, color: C.labelSecondary },
  barPct: { fontSize: 12, color: C.labelTertiary },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },

  /* Banners */
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: Spacing.lg, borderRadius: Radius.lg,
    borderWidth: 1, marginBottom: Spacing.md,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500' },

  /* Info box */
  infoBox: {
    backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: Radius.lg,
    padding: Spacing.lg, marginBottom: Spacing.xl,
  },
  infoText: { fontSize: 12, color: C.labelTertiary, lineHeight: 18 },
  infoFooter: { fontSize: 11, color: C.labelTertiary, textAlign: 'center', marginTop: 12 },

  /* Actions */
  actionsRow: { flexDirection: 'row', gap: 12 },
  primaryBtn: {
    flex: 1, height: 50, borderRadius: Radius.full,
    backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center',
    ...Shadows.sm,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  outlineBtn: {
    flex: 1, height: 50, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  outlineBtnText: { fontSize: 14, fontWeight: '700', color: C.primary },
});
