'use client';

import { useState } from 'react';
import ResumeStep from '@/components/onboarding/ResumeStep';
import ProfileStep from '@/components/onboarding/ProfileStep';
import PreferencesStep from '@/components/onboarding/PreferencesStep';
import type { UserProfile } from '@/lib/fileStore';

const STEPS = ['Resume', 'Profile', 'Preferences'] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Partial<UserProfile>>({});

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">AI Job Application Agent</h1>
          <p className="text-gray-400 mt-2">Set up your profile in 3 steps</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-8 gap-0">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center">
              <div className={`flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold transition-colors ${
                i < step ? 'bg-indigo-600 text-white' :
                i === step ? 'bg-indigo-500 text-white ring-2 ring-indigo-300' :
                'bg-gray-800 text-gray-500'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`ml-2 text-sm font-medium ${i === step ? 'text-white' : 'text-gray-500'}`}>{label}</span>
              {i < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-3 ${i < step ? 'bg-indigo-600' : 'bg-gray-700'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          {step === 0 && (
            <ResumeStep
              onNext={extractedProfile => {
                setProfile(extractedProfile);
                setStep(1);
              }}
            />
          )}
          {step === 1 && (
            <ProfileStep
              profile={profile}
              onNext={savedProfile => {
                setProfile(savedProfile);
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <PreferencesStep onBack={() => setStep(1)} />
          )}
        </div>
      </div>
    </div>
  );
}
