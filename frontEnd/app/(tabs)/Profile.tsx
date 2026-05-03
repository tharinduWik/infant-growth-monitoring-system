import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, Pressable,
  ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import {
  ChevronLeft, Edit3, LogOut,
  TrendingUp, Scale, ChevronRight,
  Baby, Calendar,
} from 'lucide-react-native';
import { Colors, Spacing, Radius, Shadows } from '@/constants/theme';
import { useAuth, Infant } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const C = Colors.light;

/* ── helpers ── */
function getInitials(fullName?: string | null, email?: string | null): string {
  if (fullName) {
    const parts = fullName.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0]?.[0]?.toUpperCase() ?? 'U';
  }
  return email?.[0]?.toUpperCase() ?? 'U';
}

function getBabyAge(dob?: string | null): string {
  if (!dob) return '';
  const birth = new Date(dob);
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (months < 1) {
    const days = Math.floor((now.getTime() - birth.getTime()) / 86400000);
    return `${days} days old`;
  }
  if (months < 12) return `${months} months old`;
  const y = Math.floor(months / 12), m = months % 12;
  return m > 0 ? `${y} yr ${m} mo old` : `${y} year old`;
}

export default function ProfileScreen() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [infant, setInfant] = useState<Infant | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('infants')
      .select('id, name, date_of_birth, gender, current_weight_kg, current_height_cm, last_measurement_date')
      .eq('parent_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setInfant(data as Infant); });
  }, [user]);

  const handleSignOut = async () => {
    // Platform-specific confirmation
    const showConfirmation = () => {
      return new Promise<boolean>((resolve) => {
        if (Platform.OS === 'web') {
          // Web: use window.confirm
          const confirmed = typeof window !== 'undefined' && window.confirm('Are you sure you want to sign out?');
          resolve(confirmed);
        } else {
          // Mobile (iOS/Android): use Alert.alert
          Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Sign Out', style: 'destructive', onPress: () => resolve(true) },
          ]);
        }
      });
    };

    const confirmed = await showConfirmation();
    if (!confirmed) return;

    setSigningOut(true);
    try { 
      await signOut(); 
      // Add a small delay to ensure session is cleared before navigation
      await new Promise(resolve => setTimeout(resolve, 500));
      router.replace('/(auth)/sign-in'); 
    }
    catch (error: any) { 
      console.error('[signOut] Error:', error);
      const errorMsg = error?.message || 'Failed to sign out. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(errorMsg);
      } else {
        Alert.alert('Error', errorMsg);
      }
    }
    finally { 
      setSigningOut(false); 
    }
  };

  if (!user || !profile) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}><ActivityIndicator size="large" color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  const displayName = profile.full_name || user.email?.split('@')[0] || 'User';
  const initials    = getInitials(profile.full_name, user.email);
  const babyAge     = getBabyAge(infant?.date_of_birth ?? null);
  const hasStats    = infant?.current_weight_kg != null || infant?.current_height_cm != null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Top bar with back button ── */}
        <Animated.View entering={FadeInUp.duration(300).springify()} style={s.topBar}>
          <Pressable
            style={s.backBtn}
            onPress={() => router.push('/(tabs)/' as any)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ChevronLeft size={20} color={C.label} strokeWidth={2} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.pageTitle}>Profile</Text>
          <Pressable
            style={s.editPill}
            onPress={() => router.push('/(tabs)/edit-profile' as any)}
          >
            <Edit3 size={13} color={C.primary} strokeWidth={2} />
            <Text style={s.editPillText}>Edit</Text>
          </Pressable>
        </Animated.View>

        {/* ── Avatar + Name card ── */}
        <Animated.View entering={FadeInDown.delay(60).springify().damping(14)}>
          <View style={s.profileCard}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
            ) : (
              <View style={s.avatarCircle}>
                <Text style={s.avatarInitials}>{initials}</Text>
              </View>
            )}
            <Text style={s.displayName}>{displayName}</Text>
            <Text style={s.email}>{user.email}</Text>
            {!!profile.bio && (
              <Text style={s.bio}>{profile.bio}</Text>
            )}
          </View>
        </Animated.View>

        {/* ── Baby card ── */}
        {infant && (
          <Animated.View entering={FadeInDown.delay(130).springify().damping(14)}>
            <Text style={s.sectionLabel}>Baby</Text>
            <View style={s.card}>
              {/* Baby identity row */}
              <View style={s.babyRow}>
                <View style={[s.babyIcon, { backgroundColor: C.primarySoft }]}>
                  <Baby size={18} color={C.primary} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.babyName}>{infant.name}</Text>
                  {babyAge ? <Text style={s.babyAge}>{babyAge}</Text> : null}
                </View>
                {infant.gender && (
                  <Text style={s.genderBadge}>{infant.gender === 'male' ? '👦' : '👧'}</Text>
                )}
              </View>

              {/* Stats */}
              {hasStats && (
                <View style={s.statsRow}>
                  {infant.current_weight_kg != null && (
                    <View style={s.stat}>
                      <Text style={s.statVal}>{infant.current_weight_kg} kg</Text>
                      <Text style={s.statLbl}>Weight</Text>
                    </View>
                  )}
                  {infant.current_weight_kg != null && infant.current_height_cm != null && (
                    <View style={s.statDivider} />
                  )}
                  {infant.current_height_cm != null && (
                    <View style={s.stat}>
                      <Text style={s.statVal}>{infant.current_height_cm} cm</Text>
                      <Text style={s.statLbl}>Height</Text>
                    </View>
                  )}
                  {infant.last_measurement_date && (
                    <>
                      <View style={s.statDivider} />
                      <View style={s.stat}>
                        <Text style={s.statVal}>
                          {new Date(infant.last_measurement_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                        <Text style={s.statLbl}>Last measured</Text>
                      </View>
                    </>
                  )}
                </View>
              )}

              {/* Add measurements CTA if none */}
              {!hasStats && (
                <Pressable
                  style={s.addRow}
                  onPress={() => router.push('/(tabs)/update-measurements' as any)}
                >
                  <Text style={s.addRowText}>Add first measurements</Text>
                  <ChevronRight size={14} color={C.primary} strokeWidth={2} />
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}

        {/* ── Menu ── */}
        <Animated.View entering={FadeInDown.delay(200).springify().damping(14)}>
          <Text style={s.sectionLabel}>Growth</Text>
          <View style={s.card}>
            <MenuRow
              icon={TrendingUp} iconColor={C.primary} iconBg={C.primarySoft}
              label="Growth History"
              onPress={() => router.push('/(tabs)/growth-history' as any)}
            />
            <View style={s.divider} />
            <MenuRow
              icon={Scale} iconColor={C.success} iconBg={C.successSoft}
              label="Update Measurements"
              onPress={() => router.push('/(tabs)/update-measurements' as any)}
            />
            <View style={s.divider} />
            <MenuRow
              icon={Calendar} iconColor={C.accent} iconBg={C.accentSoft}
              label="Growth Insights"
              onPress={() => router.push('/(tabs)/growth-insights' as any)}
            />
          </View>
        </Animated.View>

        {/* ── Sign out ── */}
        <Animated.View entering={FadeInDown.delay(280).springify().damping(14)}>
          <Pressable
            style={[s.signOutBtn, signingOut && { opacity: 0.55 }]}
            onPress={handleSignOut}
            disabled={signingOut}
          >
            <LogOut size={17} color={C.danger} strokeWidth={1.8} />
            <Text style={s.signOutText}>
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </Text>
          </Pressable>
        </Animated.View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon: Icon, iconColor, iconBg, label, onPress }: {
  icon: any; iconColor: string; iconBg: string;
  label: string; onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.menuRow, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: iconBg }]}>
        <Icon size={16} color={iconColor} strokeWidth={1.8} />
      </View>
      <Text style={s.menuLabel}>{label}</Text>
      <ChevronRight size={15} color={C.labelTertiary} strokeWidth={1.8} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  loader:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: Spacing.screenPadding, paddingTop: 8, paddingBottom: 40 },

  /* Top bar */
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: Spacing.xl,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 6,
  },
  backText:  { fontSize: 15, color: C.label, fontWeight: '500' },
  pageTitle: { fontSize: 17, fontWeight: '700', color: C.label, letterSpacing: -0.3 },
  editPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: C.primary,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full,
  },
  editPillText: { fontSize: 13, fontWeight: '700', color: C.primary },

  /* Profile card */
  profileCard: {
    backgroundColor: C.card, borderRadius: Radius.xxl,
    padding: Spacing.xl, alignItems: 'center',
    marginBottom: Spacing.xl, ...Shadows.md,
  },
  avatar: {
    width: 90, height: 90, borderRadius: 45,
    marginBottom: Spacing.lg,
    borderWidth: 3, borderColor: C.primarySoft,
  },
  avatarCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: C.primary,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: Spacing.lg,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  avatarInitials: { fontSize: 34, fontWeight: '700', color: '#FFF' },
  displayName:    { fontSize: 20, fontWeight: '700', color: C.label, marginBottom: 4 },
  email:          { fontSize: 13, color: C.labelTertiary, marginBottom: Spacing.sm },
  bio: {
    fontSize: 13, color: C.labelTertiary, textAlign: 'center',
    lineHeight: 20, marginTop: 4, fontStyle: 'italic',
  },

  /* Section label */
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: C.labelTertiary,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: Spacing.sm, marginLeft: 4, marginTop: 4,
  },

  /* Card shell */
  card: {
    backgroundColor: C.card, borderRadius: Radius.xl,
    overflow: 'hidden', marginBottom: Spacing.xl, ...Shadows.sm,
  },

  /* Baby row */
  babyRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.md, padding: Spacing.lg,
  },
  babyIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  babyName:    { fontSize: 16, fontWeight: '700', color: C.label },
  babyAge:     { fontSize: 12, color: C.labelTertiary, marginTop: 1 },
  genderBadge: { fontSize: 22 },

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.cardSecondary,
  },
  stat:        { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statVal:     { fontSize: 16, fontWeight: '700', color: C.label, marginBottom: 2 },
  statLbl:     { fontSize: 10, color: C.labelTertiary, fontWeight: '500' },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 8 },

  /* Add row */
  addRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.lg,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  addRowText: { fontSize: 14, color: C.primary, fontWeight: '600' },

  /* Menu */
  menuRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.md, padding: Spacing.lg,
  },
  menuIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: C.label },
  divider:   { height: 1, backgroundColor: C.border, marginHorizontal: Spacing.lg },

  /* Sign out */
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: C.dangerSoft,
    borderRadius: Radius.xl, paddingVertical: 16,
    marginTop: Spacing.sm,
  },
  signOutText: { fontSize: 15, fontWeight: '700', color: C.danger },
});
