import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Gauge,
  Sparkles,
  Headphones,
  FileText,
  Lock,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { Link } from 'react-router-dom';

export interface AudioSummaryPlayerProps {
  materialTitle: string;
  courseCode?: string;
  department?: string;
  summaryText?: string;
}

export const AudioSummaryPlayer: React.FC<AudioSummaryPlayerProps> = ({
  materialTitle,
  courseCode = 'Course',
  department = 'Department',
  summaryText,
}) => {
  const { hasPremium } = useAuth();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [currentParagraph, setCurrentParagraph] = useState(0);
  const [supported, setSupported] = useState(true);

  // Default syllabus high-yield summary text if none provided
  const textContent =
    summaryText ||
    `Welcome to the audio study digest for ${materialTitle}, registered under ${courseCode} in the ${department}. ` +
    `Section one: Core Theoretical Concepts. In this unit, key foundational models are explored, examining primary definitions, governing laws, and experimental frameworks. ` +
    `Section two: Practical Methodologies and Calculations. Focus on problem-solving mechanics, applying standard derivations to continuous assessment and past examination scenarios. ` +
    `Section three: Key Examination Takeaways. Ensure you master the core definitions, comparative classifications, and step-by-step proofs frequently repeated in previous session tests. Review complete formulas in your printed course guide.`;

  const paragraphs = textContent.split('. ').filter(Boolean).map((p) => p.trim() + '.');

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    } else {
      setSupported(false);
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const handlePlay = () => {
    if (!synthRef.current) return;

    if (synthRef.current.paused) {
      synthRef.current.resume();
      setIsPlaying(true);
      return;
    }

    synthRef.current.cancel();

    // Read full remaining text starting from current paragraph
    const textToRead = paragraphs.slice(currentParagraph).join(' ');
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = playbackRate;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      setIsPlaying(false);
      setCurrentParagraph(0);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;
    synthRef.current.speak(utterance);
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (!synthRef.current) return;
    synthRef.current.pause();
    setIsPlaying(false);
  };

  const handleStop = () => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    setIsPlaying(false);
    setCurrentParagraph(0);
  };

  const handleChangeRate = (rate: number) => {
    setPlaybackRate(rate);
    if (isPlaying) {
      handleStop();
    }
  };

  if (!supported) {
    return (
      <div style={{ padding: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#991b1b' }}>
        Audio playback is not supported by your current browser. Please use Chrome, Safari, Edge, or Firefox.
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #dcebe0',
        borderRadius: 14,
        padding: 20,
        boxShadow: '0 2px 8px rgba(18, 41, 28, 0.04)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#e8f5ec', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Headphones size={20} color="#12603d" />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#17231d' }}>
              Spoken Audio Summary Digest
            </h4>
            <span style={{ fontSize: 12, color: '#55675b' }}>
              5-minute hands-free lecture review for walks &amp; hostel commutes
            </span>
          </div>
        </div>

        {!hasPremium && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 8px', borderRadius: 999 }}>
            Sample Preview Mode
          </span>
        )}
      </div>

      {/* Audio Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8faf9',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isPlaying ? (
            <button
              type="button"
              onClick={handlePause}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#12603d', color: '#ffffff', borderColor: '#12603d' }}
            >
              <Pause size={16} /> Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePlay}
              className="btn btn-primary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8 }}
            >
              <Play size={16} /> Listen Now
            </button>
          )}

          <button
            type="button"
            onClick={handleStop}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8 }}
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>

        {/* Speed Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Gauge size={14} color="#55675b" />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#55675b' }}>Speed:</span>
          {[0.75, 1.0, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => handleChangeRate(rate)}
              style={{
                border: playbackRate === rate ? '1px solid #12603d' : '1px solid #d1d5db',
                background: playbackRate === rate ? '#e8f5ec' : '#ffffff',
                color: playbackRate === rate ? '#12603d' : '#4b5563',
                fontWeight: playbackRate === rate ? 700 : 500,
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* Transcript Text Scroller */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 14,
          maxHeight: 150,
          overflowY: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          color: '#374151',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#059669', marginBottom: 6 }}>
          Digest Script
        </div>
        {paragraphs.map((p, idx) => (
          <p key={idx} style={{ margin: '0 0 6px' }}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
};

export default AudioSummaryPlayer;
