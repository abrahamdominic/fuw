import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  BookOpen,
  ShoppingBag,
  Home,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  GraduationCap,
  Sparkles,
  ShieldCheck,
  Building,
  UserCheck,
  FileText,
  Bell,
  Users,
  Compass,
  Lock,
  Loader2,
  Info
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { catalogue, facultyByName, levelsFor } from '../data/catalogue';
import { completeUserOnboarding, lecturerUpdateOwnProfile } from '../lib/academics';
import { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';

interface StudentInterest {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const STUDENT_INTERESTS: StudentInterest[] = [
  {
    id: 'elibrary',
    label: 'E-Library & Past Questions',
    desc: 'Instant access to verified lecture notes, handouts, test questions & exam past questions.',
    icon: <BookOpen size={20} color="var(--green-700, #12603d)" />
  },
  {
    id: 'marketplace',
    label: 'FUW Campus Marketplace',
    desc: 'Buy, sell, order meals and book campus services with escrow buyer protection.',
    icon: <ShoppingBag size={20} color="var(--green-700, #12603d)" />
  },
  {
    id: 'accommodation',
    label: 'Student Accomodation',
    desc: 'Browse verified student lodges, off-campus hostels and connect with room seekers.',
    icon: <Home size={20} color="var(--green-700, #12603d)" />
  },
  {
    id: 'ai_tutor',
    label: 'AI Study Assistant',
    desc: 'Generate flashcards, practice exam prep, and analyze past exam questions with AI.',
    icon: <Sparkles size={20} color="#b45309" />
  }
];

export const OnboardingPage: React.FC = () => {
  const {
    user,
    profile,
    role,
    isStudent,
    isLecturer,
    isAdmin,
    isSuperAdmin,
    completeProfile,
    updateProfile,
    setOnboardingState,
    refreshProfile
  } = useAuth();

  const navigate = useNavigate();
  const { toast } = useToast();

  // Resolved role destination
  const destination = useMemo(() => {
    if (isSuperAdmin) return '/super';
    if (isAdmin) return '/admin';
    if (isLecturer) return '/lecturer';
    return '/hub';
  }, [isSuperAdmin, isAdmin, isLecturer]);

  // Current step state (resumable from profile.onboardingStep)
  const [currentStep, setCurrentStep] = useState<number>(profile?.onboardingStep || 1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Student specific form state
  const [faculty, setFaculty] = useState<string>(profile?.faculty || '');
  const [department, setDepartment] = useState<string>(profile?.department || '');
  const [level, setLevel] = useState<string>(profile?.level || '100 Level');
  const [matricNumber, setMatricNumber] = useState<string>(profile?.matricNumber || '');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([
    'elibrary',
    'marketplace',
    'accommodation',
    'ai_tutor'
  ]);

  // Lecturer specific form state
  const [officeLocation, setOfficeLocation] = useState<string>('');
  const [phone, setPhone] = useState<string>(profile?.phoneNumber || '');
  const [bio, setBio] = useState<string>(profile?.bio || '');

  // Step definitions per role
  const totalSteps = useMemo(() => {
    if (isStudent) return 5;
    if (isLecturer) return 5;
    if (isAdmin || isSuperAdmin) return 4;
    return 4;
  }, [isStudent, isLecturer, isAdmin, isSuperAdmin]);

  // Sync state if profile loads asynchronously
  useEffect(() => {
    if (profile?.onboardingStep && profile.onboardingStep > currentStep) {
      setCurrentStep(profile.onboardingStep);
    }
    if (profile?.faculty && !faculty) setFaculty(profile.faculty);
    if (profile?.department && !department) setDepartment(profile.department);
    if (profile?.level && !level) setLevel(profile.level);
    if (profile?.matricNumber && !matricNumber) setMatricNumber(profile.matricNumber);
    if (profile?.phoneNumber && !phone) setPhone(profile.phoneNumber);
    if (profile?.bio && !bio) setBio(profile.bio);
  }, [profile]);

  // Available departments based on selected faculty
  const facultyObj = useMemo(() => facultyByName(faculty), [faculty]);
  const availableDepts = useMemo(() => facultyObj?.departments || [], [facultyObj]);
  const deptObj = useMemo(
    () => availableDepts.find((d) => d.name === department),
    [availableDepts, department]
  );
  const availableLevels = useMemo(
    () => levelsFor(deptObj?.duration || 4),
    [deptObj]
  );

  // Friendly user greeting name
  const userName = useMemo(() => {
    if (profile?.fullName && profile.fullName.trim()) {
      return profile.fullName.trim();
    }
    if (profile?.displayName && profile.displayName.trim()) {
      return profile.displayName.trim();
    }
    if (user?.email) {
      const emailName = user.email.split('@')[0];
      return emailName.charAt(0).toUpperCase() + emailName.slice(1);
    }
    return 'Scholar';
  }, [profile, user]);

  const saveStepProgress = async (nextStep: number, isFinished = false) => {
    setIsSubmitting(true);
    try {
      await setOnboardingState(nextStep, isFinished);
      if (isFinished) {
        toast('Welcome aboard! Your workspace is ready.', 'success');
        navigate(destination, { replace: true });
      } else {
        setCurrentStep(nextStep);
      }
    } catch (err: any) {
      toast(err.message || 'Failed to update progress.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2 Submission (Student Academic Profile)
  // ---------------------------------------------------------------------------
  const handleStudentAcademicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faculty) {
      toast('Please select your faculty.', 'error');
      return;
    }
    if (!department) {
      toast('Please select your department.', 'error');
      return;
    }
    if (!level) {
      toast('Please select your current academic level.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateProfile({
        faculty,
        department,
        level
      });
      await saveStepProgress(3);
    } catch (err: any) {
      toast(err.message || 'Failed to save academic profile.', 'error');
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 3 Submission (Student Matric & Verification)
  // ---------------------------------------------------------------------------
  const handleStudentMatricSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (matricNumber.trim()) {
      setIsSubmitting(true);
      try {
        await updateProfile({
          matricNumber: matricNumber.trim().toUpperCase()
        });
      } catch (err: any) {
        toast(err.message || 'Failed to save matric number.', 'error');
        setIsSubmitting(false);
        return;
      }
    }
    await saveStepProgress(4);
  };

  // ---------------------------------------------------------------------------
  // Lecturer Step 3 Submission (Office location & contact)
  // ---------------------------------------------------------------------------
  const handleLecturerContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (officeLocation.trim() || phone.trim() || bio.trim()) {
        await lecturerUpdateOwnProfile({
          officeLocation: officeLocation.trim(),
          phone: phone.trim(),
          bio: bio.trim()
        });
      }
      await saveStepProgress(4);
    } catch (err: any) {
      toast(err.message || 'Failed to save lecturer profile details.', 'error');
      setIsSubmitting(false);
    }
  };

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // If already onboarded, offer quick launch or profile review
  const isAlreadyOnboarded = profile?.onboardingCompleted;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--surface-alt, #f7faf8)',
        color: 'var(--text-primary, #17231d)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px',
        boxSizing: 'border-box'
      }}
    >
      {/* Top Brand Header */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={36} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--green-900, #0d4a2f)' }}>
              FEDERAL UNIVERSITY WUKARI
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
              Integrated Campus Ecosystem · Personalized Onboarding
            </div>
          </div>
        </div>

        {isAlreadyOnboarded && (
          <Link
            to={destination}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green-800, #12603d)',
              textDecoration: 'none',
              background: '#e8f5ec',
              padding: '6px 12px',
              borderRadius: 20
            }}
          >
            Go to Workspace →
          </Link>
        )}
      </div>

      {/* Progress Indicator */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 16,
          padding: '16px 20px',
          marginBottom: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            fontSize: 13
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--green-900, #0d4a2f)' }}>
            Step {currentStep} of {totalSteps}
          </span>
          <span style={{ color: 'var(--text-secondary, #55675b)', fontSize: 12 }}>
            {isStudent && (
              currentStep === 1 ? 'Welcome' :
              currentStep === 2 ? 'Academic Structure' :
              currentStep === 3 ? 'Institutional Identity' :
              currentStep === 4 ? 'Campus Features' :
              'Launch Ready'
            )}
            {isLecturer && (
              currentStep === 1 ? 'Academic Greeting' :
              currentStep === 2 ? 'Credentials Review' :
              currentStep === 3 ? 'Office & Contact' :
              currentStep === 4 ? 'Portal Overview' :
              'Launch Ready'
            )}
            {(isAdmin || isSuperAdmin) && (
              currentStep === 1 ? 'Executive Welcome' :
              currentStep === 2 ? 'Administrative Scope' :
              currentStep === 3 ? 'System Capabilities' :
              'Launch Ready'
            )}
          </span>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            height: 6,
            width: '100%',
            background: 'var(--surface-alt, #edf4f0)',
            borderRadius: 999,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${(currentStep / totalSteps) * 100}%`,
              background: 'linear-gradient(90deg, #12603d 0%, #1e6f43 100%)',
              transition: 'width 0.3s ease'
            }}
          />
        </div>
      </div>

      {/* Main Container Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 20,
          padding: '28px 24px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          position: 'relative'
        }}
      >
        {/* ================================================================= */}
        {/* STUDENT FLOW */}
        {/* ================================================================= */}
        {isStudent && (
          <div>
            {/* Step 1: Student Welcome */}
            {currentStep === 1 && (
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: '#e8f5ec',
                    color: 'var(--green-900, #0d4a2f)',
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 16
                  }}
                >
                  <GraduationCap size={15} /> Student Workspace Setup
                </div>

                <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 10px', color: 'var(--green-900, #0d4a2f)' }}>
                  Welcome back, {userName}!
                </h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px' }}>
                  Let's get your Federal University Wukari Campus Hub tailored to your academic curriculum.
                  We'll configure your faculty, department, verified courses, and campus services so you only see
                  materials relevant to you.
                </p>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 18,
                    marginBottom: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <BookOpen size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Curated Course Materials</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Verified lecture notes and handouts matched directly to your current academic level.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <ShoppingBag size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Peer Campus Marketplace</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Order food, campus provisions, and gadgets with guaranteed delivery and buyer escrow.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <Home size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Hostels & Student Accomodation</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Browse verified lodges around Wukari with real pictures and caretaker contacts.
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(2)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Get Started <ArrowRight size={16} /></>}
                </button>
              </div>
            )}

            {/* Step 2: Student Academic Structure */}
            {currentStep === 2 && (
              <form onSubmit={handleStudentAcademicSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 2 · Academic Details
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Select Your Faculty & Department
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    This ensures course recommendations and past questions match your exact level of study.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Faculty *
                    </label>
                    <select
                      value={faculty}
                      onChange={(e) => {
                        setFaculty(e.target.value);
                        setDepartment('');
                      }}
                      required
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)'
                      }}
                    >
                      <option value="">Select your Faculty</option>
                      {catalogue.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Department *
                    </label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      disabled={!faculty}
                      required
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: !faculty ? 'var(--surface-alt, #f4f8f5)' : 'var(--surface, #ffffff)'
                      }}
                    >
                      <option value="">{faculty ? 'Select your Department' : 'First select a Faculty'}</option>
                      {availableDepts.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Current Level *
                    </label>
                    <select
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)'
                      }}
                    >
                      {availableLevels.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !faculty || !department}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: Student Matric Number & Verification */}
            {currentStep === 3 && (
              <form onSubmit={handleStudentMatricSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 3 · Academic Identity
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Confirm Your Matriculation Number
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Your matriculation number connects your student records and enables library document verification.
                  </p>
                </div>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 20
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <ShieldCheck size={18} color="var(--green-800, #12603d)" />
                    <strong style={{ fontSize: 14 }}>Institutional Verification Status</strong>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                    {profile?.verificationStatus === 'verified' ? (
                      <span style={{ color: '#065f46', fontWeight: 700 }}>
                        ✓ Verified FUW Student Account
                      </span>
                    ) : profile?.verificationStatus === 'pending' ? (
                      <span style={{ color: '#b45309', fontWeight: 700 }}>
                        ⏳ Verification Submission in Review
                      </span>
                    ) : (
                      <span>Unverified · Entering your official matriculation number unlocks verified features.</span>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    FUW Matriculation Number
                  </label>
                  <input
                    type="text"
                    value={matricNumber}
                    onChange={(e) => setMatricNumber(e.target.value)}
                    placeholder="e.g. FUW/2022/CS/1042"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      background: 'var(--surface, #ffffff)',
                      fontFamily: 'monospace'
                    }}
                  />
                  <small style={{ display: 'block', marginTop: 6, color: 'var(--text-secondary, #55675b)' }}>
                    You can update or submit verification evidence later from your student portal.
                  </small>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            )}

            {/* Step 4: Interests & Campus Features */}
            {currentStep === 4 && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 4 · Campus Ecosystem
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Choose Your Campus Hub Priorities
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Select the features you will use most often so we highlight quick shortcuts on your home screen.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {STUDENT_INTERESTS.map((interest) => {
                    const isSelected = selectedInterests.includes(interest.id);
                    return (
                      <div
                        key={interest.id}
                        onClick={() => toggleInterest(interest.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 14,
                          padding: 14,
                          borderRadius: 12,
                          border: isSelected ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                          background: isSelected ? '#f4fbf6' : 'var(--surface, #ffffff)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ marginTop: 2 }}>{interest.icon}</div>
                        <div style={{ flex: 1 }}>
                          <strong style={{ fontSize: 14, color: 'var(--green-900, #0d4a2f)' }}>{interest.label}</strong>
                          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
                            {interest.desc}
                          </p>
                        </div>
                        <CheckCircle
                          size={20}
                          color={isSelected ? 'var(--green-800, #12603d)' : '#c0d4c7'}
                          style={{ marginTop: 2 }}
                        />
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => saveStepProgress(5)}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Ready / Launch */}
            {currentStep === 5 && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: '#e8f5ec',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}
                >
                  <CheckCircle size={36} color="var(--green-800, #12603d)" />
                </div>

                <h2 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 8px', color: 'var(--green-900, #0d4a2f)' }}>
                  You're Ready, {userName}!
                </h2>
                <p style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px', lineHeight: 1.6 }}>
                  Your personal profile is active. You can now access your customized course materials,
                  order goods securely from verified students, and find verified accommodation.
                </p>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 28,
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', marginBottom: 8 }}>
                    YOUR CONFIGURED PROFILE:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Faculty:</span>{' '}
                      <strong>{faculty || 'Configured'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Department:</span>{' '}
                      <strong>{department || 'Configured'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Level:</span>{' '}
                      <strong>{level}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Matric:</span>{' '}
                      <strong>{matricNumber || 'Optional'}</strong>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(5, true)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  {isSubmitting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      Enter FUW Campus Hub <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* LECTURER FLOW */}
        {/* ================================================================= */}
        {isLecturer && (
          <div>
            {/* Step 1: Lecturer Welcome */}
            {currentStep === 1 && (
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: '#e8f5ec',
                    color: 'var(--green-900, #0d4a2f)',
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 16
                  }}
                >
                  <Building size={15} /> Academic Staff Portal
                </div>

                <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 10px', color: 'var(--green-900, #0d4a2f)' }}>
                  Welcome, {profile?.displayName || userName}!
                </h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px' }}>
                  Your dedicated Federal University Wukari academic workspace is ready.
                  As an academic lecturer, you have direct publishing authority over educational materials, course handouts,
                  and targeted department broadcasts.
                </p>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 18,
                    marginBottom: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <FileText size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Instant Direct Publishing</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Publish course notes and handouts directly into the repository without moderation delays.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <Bell size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Targeted Academic Announcements</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Broadcast assignments and notifications targeted specifically to your faculty and departments.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <Users size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Student Engagement & Analytics</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Track verified reading history, downloads, and student feedback across all uploaded materials.
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(2)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Confirm Academic Scope <ArrowRight size={16} /></>}
                </button>
              </div>
            )}

            {/* Step 2: Lecturer Academic Credentials Confirmation */}
            {currentStep === 2 && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 2 · Institutional Scope
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Assigned Academic Appointment
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Please review your institutional credentials below. These define which students receive your
                    materials and announcements.
                  </p>
                </div>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 20,
                    marginBottom: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Full Academic Name</span>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{profile?.fullName || userName}</div>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Primary Faculty Appointment</span>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{profile?.faculty || 'Not Yet Set'}</div>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Primary Academic Department</span>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{profile?.department || 'Not Yet Set'}</div>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Institutional Email</span>
                    <div style={{ fontSize: 14, fontFamily: 'monospace' }}>{user?.email}</div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: 14,
                    borderRadius: 10,
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    marginBottom: 24,
                    fontSize: 13,
                    color: '#92400e'
                  }}
                >
                  <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Administrative Clearance Policy:</strong> Academic roles and departmental assignments are
                    governed by platform administrators. If any appointment detail is inaccurate, contact the repository
                    administrator to request an update.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => saveStepProgress(3)}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Confirm & Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Lecturer Office & Contact Details */}
            {currentStep === 3 && (
              <form onSubmit={handleLecturerContactSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 3 · Office & Contact
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Complete Your Lecturer Profile
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Help students and colleagues locate your office and learn about your research focus.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Office Location
                    </label>
                    <input
                      type="text"
                      value={officeLocation}
                      onChange={(e) => setOfficeLocation(e.target.value)}
                      placeholder="e.g. Faculty of Science Block B, Room 204"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Contact Phone Number
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 08012345678"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Academic Statement / Bio
                    </label>
                    <textarea
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Brief research areas, consultation hours, or teaching portfolio..."
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Save & Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            )}

            {/* Step 4: Lecturer Portal Tour */}
            {currentStep === 4 && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 4 · Portal Features
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Your Lecturer Capabilities
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Here is a summary of what you can accomplish from your dedicated workspace:
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                  <div style={{ display: 'flex', gap: 14, padding: 14, borderRadius: 12, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)' }}>
                    <div style={{ background: '#e8f5ec', padding: 10, borderRadius: 10, height: 'fit-content' }}>
                      <FileText size={20} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14, color: 'var(--green-900, #0d4a2f)' }}>Direct Publishing to Repository</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)', lineHeight: 1.5 }}>
                        Upload syllabus materials, slides, and handouts that immediately show up in student feeds without requiring admin approval.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, padding: 14, borderRadius: 12, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)' }}>
                    <div style={{ background: '#e8f5ec', padding: 10, borderRadius: 10, height: 'fit-content' }}>
                      <Bell size={20} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14, color: 'var(--green-900, #0d4a2f)' }}>Department-Level Announcements</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)', lineHeight: 1.5 }}>
                        Send targeted notices directly to students registered in your department with instant notifications.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, padding: 14, borderRadius: 12, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)' }}>
                    <div style={{ background: '#e8f5ec', padding: 10, borderRadius: 10, height: 'fit-content' }}>
                      <CheckCircle size={20} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14, color: 'var(--green-900, #0d4a2f)' }}>Verified Academic Identity</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)', lineHeight: 1.5 }}>
                        All your published notes carry the official FUW verified academic badge with your rank and credentials.
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => saveStepProgress(5)}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Lecturer Ready / Launch */}
            {currentStep === 5 && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: '#e8f5ec',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}
                >
                  <Building size={36} color="var(--green-800, #12603d)" />
                </div>

                <h2 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 8px', color: 'var(--green-900, #0d4a2f)' }}>
                  Your Academic Portal is Ready
                </h2>
                <p style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px', lineHeight: 1.6 }}>
                  You are fully onboarded as an authorized lecturer at Federal University Wukari.
                  You can now manage your published documents and broadcast announcements.
                </p>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 28,
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', marginBottom: 8 }}>
                    ACADEMIC CLEARANCE PROFILE:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Faculty:</span>{' '}
                      <strong>{profile?.faculty || 'Verified'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Department:</span>{' '}
                      <strong>{profile?.department || 'Verified'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Role:</span>{' '}
                      <strong>Academic Lecturer</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>Direct Publish:</span>{' '}
                      <strong style={{ color: '#065f46' }}>Enabled ✓</strong>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(5, true)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  {isSubmitting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      Enter Lecturer Portal <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* ADMIN FLOW */}
        {/* ================================================================= */}
        {(isAdmin || isSuperAdmin) && (
          <div>
            {/* Step 1: Admin Welcome */}
            {currentStep === 1 && (
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: '#fee2e2',
                    color: '#991b1b',
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 16
                  }}
                >
                  <ShieldCheck size={15} /> Administrative Governance Suite
                </div>

                <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 10px', color: 'var(--green-900, #0d4a2f)' }}>
                  Welcome, Administrator {userName}!
                </h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px' }}>
                  Your administrative account is authenticated with{' '}
                  <strong>{isSuperAdmin ? 'Super Administrator' : 'Platform Administrator'}</strong> clearance.
                  Let's verify your governance controls and security settings.
                </p>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 18,
                    marginBottom: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <Users size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>User & Lecturer Management</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Onboard faculty members, manage multi-department scopes, and approve student verifications.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <ShoppingBag size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Marketplace & Vendor Review</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Review vendor store verifications, monitor payouts, and resolve student disputes.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#e8f5ec', padding: 8, borderRadius: 8 }}>
                      <ShieldCheck size={18} color="var(--green-800, #12603d)" />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>Platform Audit & Security</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Full immutable audit log for permissions, user conversions, and content takedown notices.
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(2)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Review Permissions <ArrowRight size={16} /></>}
                </button>
              </div>
            )}

            {/* Step 2: Admin Profile & Permissions Confirmation */}
            {currentStep === 2 && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 2 · Clearance Level
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Your Administrative Authorization
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Clearance is granted through server-side role-based policies.
                  </p>
                </div>

                <div
                  style={{
                    background: 'var(--surface-alt, #f7faf8)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 20,
                    marginBottom: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Clearance Rank</span>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#991b1b' }}>
                      {isSuperAdmin ? 'Super Administrator (Full System)' : 'Platform Administrator'}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Authorized Email</span>
                    <div style={{ fontSize: 14, fontFamily: 'monospace' }}>{user?.email}</div>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Active Privileges</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      <span style={{ background: '#e8f5ec', color: '#065f46', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                        manage_materials
                      </span>
                      <span style={{ background: '#e8f5ec', color: '#065f46', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                        manage_lecturers
                      </span>
                      <span style={{ background: '#e8f5ec', color: '#065f46', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                        verify_vendors
                      </span>
                      <span style={{ background: '#e8f5ec', color: '#065f46', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                        broadcast_announcements
                      </span>
                      {isSuperAdmin && (
                        <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                          super_admin_governance
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => saveStepProgress(3)}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Admin Suite Overview */}
            {currentStep === 3 && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase' }}>
                    Step 3 · Operational Standards
                  </span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px', color: 'var(--green-900, #0d4a2f)' }}>
                    Administrative Governance Guidelines
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', margin: 0 }}>
                    Please observe Federal University Wukari platform security requirements:
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--green-900, #0d4a2f)', display: 'block', marginBottom: 4 }}>
                      1. Verification Decision Integrity
                    </strong>
                    Rejecting a vendor or student verification requires providing a descriptive reason (10+ characters)
                    recorded in the system audit logs.
                  </div>

                  <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--green-900, #0d4a2f)', display: 'block', marginBottom: 4 }}>
                      2. Lecturer Appointment Governance
                    </strong>
                    Lecturer onboarding assigns official academic scope. When converting users to lecturers, ensure
                    institutional department and rank match official university records.
                  </div>

                  <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--green-900, #0d4a2f)', display: 'block', marginBottom: 4 }}>
                      3. Two-Factor Authentication (2FA)
                    </strong>
                    Administrative accounts are encouraged to enable TOTP Multi-Factor Authentication from the Security tab.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="btn btn-secondary"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => saveStepProgress(4)}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'var(--green-900, #0d4a2f)',
                      color: '#fff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Admin Ready / Launch */}
            {currentStep === 4 && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: '#fee2e2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}
                >
                  <ShieldCheck size={36} color="#991b1b" />
                </div>

                <h2 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 8px', color: 'var(--green-900, #0d4a2f)' }}>
                  Administration Workspace Ready
                </h2>
                <p style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', margin: '0 0 24px', lineHeight: 1.6 }}>
                  You are cleared to manage the Federal University Wukari platform.
                  You can now monitor platform health, review vendor requests, and manage repository assets.
                </p>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => saveStepProgress(4, true)}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    borderRadius: 10,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  {isSubmitting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      Enter Admin Portal <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
