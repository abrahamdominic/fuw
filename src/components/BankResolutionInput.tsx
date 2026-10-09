import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Building, HelpCircle } from 'lucide-react';
import { fetchNigerianBanks, resolveBankAccount, NigerianBank } from '../marketplace/lib/api';

export interface BankResolutionDetails {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isVerified: boolean;
  isManualFallback?: boolean;
}

interface BankResolutionInputProps {
  initialBankCode?: string;
  initialBankName?: string;
  initialAccountNumber?: string;
  initialAccountName?: string;
  onChange: (details: BankResolutionDetails) => void;
  disabled?: boolean;
}

const FALLBACK_BANKS: NigerianBank[] = [
  { name: 'OPay Digital Services (Paycom)', code: '999992', slug: 'opay' },
  { name: 'PalmPay', code: '999991', slug: 'palmpay' },
  { name: 'Moniepoint Microfinance Bank', code: '50515', slug: 'moniepoint-mfb' },
  { name: 'Kuda Bank', code: '50211', slug: 'kuda-bank' },
  { name: 'Access Bank', code: '044', slug: 'access-bank' },
  { name: 'Guaranty Trust Bank (GTBank)', code: '058', slug: 'gtbank' },
  { name: 'United Bank for Africa (UBA)', code: '033', slug: 'united-bank-for-africa' },
  { name: 'Zenith Bank', code: '057', slug: 'zenith-bank' },
  { name: 'First Bank of Nigeria', code: '011', slug: 'first-bank-of-nigeria' },
  { name: 'Fidelity Bank', code: '070', slug: 'fidelity-bank' },
  { name: 'Stanbic IBTC Bank', code: '221', slug: 'stanbic-ibtc-bank' },
  { name: 'Union Bank of Nigeria', code: '032', slug: 'union-bank-of-nigeria' },
  { name: 'Wema Bank (ALAT)', code: '035', slug: 'wema-bank' },
  { name: 'Sterling Bank', code: '232', slug: 'sterling-bank' },
  { name: 'FCMB', code: '214', slug: 'first-city-monument-bank' }
];

export const BankResolutionInput: React.FC<BankResolutionInputProps> = ({
  initialBankCode = '',
  initialBankName = '',
  initialAccountNumber = '',
  initialAccountName = '',
  onChange,
  disabled = false
}) => {
  const [banks, setBanks] = useState<NigerianBank[]>(FALLBACK_BANKS);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [bankCode, setBankCode] = useState(initialBankCode);
  const [bankName, setBankName] = useState(initialBankName);
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber);
  const [accountName, setAccountName] = useState(initialAccountName);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(Boolean(initialAccountName));
  const [allowManualFallback, setAllowManualFallback] = useState(false);
  const [isManualConfirmed, setIsManualConfirmed] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load live bank list
  useEffect(() => {
    let active = true;
    setLoadingBanks(true);
    fetchNigerianBanks()
      .then((liveBanks) => {
        if (active && liveBanks && liveBanks.length > 0) {
          setBanks(liveBanks);
        }
      })
      .catch(() => {
        // Keeps fallback banks
      })
      .finally(() => {
        if (active) setLoadingBanks(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Update bank name when code changes
  const handleBankChange = (code: string) => {
    setBankCode(code);
    const selected = banks.find((b) => b.code === code);
    const name = selected ? selected.name : '';
    setBankName(name);
    setAccountName('');
    setIsVerified(false);
    setIsManualConfirmed(false);
    setResolveError(null);
  };

  // Handle account number changes & debounced auto-resolution
  const handleAccountNumberChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 10);
    setAccountNumber(cleaned);
    setAccountName('');
    setIsVerified(false);
    setIsManualConfirmed(false);
    setResolveError(null);
  };

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (accountNumber.length === 10 && bankCode) {
      setIsResolving(true);
      setResolveError(null);

      debounceTimerRef.current = setTimeout(async () => {
        try {
          const res = await resolveBankAccount(accountNumber, bankCode);
          if (res && res.account_name) {
            setAccountName(res.account_name);
            setIsVerified(true);
            setResolveError(null);
            setAllowManualFallback(false);
            setIsManualConfirmed(false);
            onChange({
              bankCode,
              bankName,
              accountNumber,
              accountName: res.account_name,
              isVerified: true,
              isManualFallback: false
            });
          } else {
            throw new Error('Account name could not be resolved.');
          }
        } catch (err: any) {
          const msg = err.message || 'Could not verify account name. Check account number and bank.';
          setAccountName('');
          setIsVerified(false);
          setResolveError(msg);
          setAllowManualFallback(true);
          onChange({
            bankCode,
            bankName,
            accountNumber,
            accountName: '',
            isVerified: false
          });
        } finally {
          setIsResolving(false);
        }
      }, 450);
    } else {
      setIsResolving(false);
      if (accountNumber.length > 0 && accountNumber.length < 10) {
        setResolveError('Account number must be 10 digits.');
      } else {
        setResolveError(null);
      }
      setIsVerified(false);
      onChange({
        bankCode,
        bankName,
        accountNumber,
        accountName: '',
        isVerified: false
      });
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [accountNumber, bankCode, bankName, onChange]);

  const handleManualNameChange = (name: string) => {
    setAccountName(name);
    const valid = name.trim().length >= 3;
    setIsManualConfirmed(valid);
    onChange({
      bankCode,
      bankName,
      accountNumber,
      accountName: name.trim(),
      isVerified: valid,
      isManualFallback: true
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Bank Selection */}
      <div>
        <label
          htmlFor="bank-select"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 6,
            color: 'var(--text-primary, #17231d)'
          }}
        >
          <Building size={15} color="var(--primary, #0B6B3A)" />
          Destination Bank *
        </label>
        <select
          id="bank-select"
          value={bankCode}
          disabled={disabled || loadingBanks}
          onChange={(e) => handleBankChange(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border, #dcebe0)',
            backgroundColor: 'var(--surface, #ffffff)',
            color: 'var(--text-primary, #17231d)',
            fontSize: 14,
            outline: 'none'
          }}
        >
          <option value="">{loadingBanks ? 'Loading banks...' : 'Select your Nigerian bank'}</option>
          {banks.map((b) => (
            <option key={`${b.code}-${b.slug}`} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Account Number Input */}
      <div>
        <label
          htmlFor="account-number-input"
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 6,
            color: 'var(--text-primary, #17231d)'
          }}
        >
          10-Digit NUBAN Account Number *
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="account-number-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="0123456789"
            value={accountNumber}
            disabled={disabled || !bankCode}
            onChange={(e) => handleAccountNumberChange(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px 40px 10px 12px',
              borderRadius: 8,
              border: `1px solid ${
                isVerified
                  ? 'var(--success, #16a34a)'
                  : resolveError
                  ? 'var(--error, #dc2626)'
                  : 'var(--border, #dcebe0)'
              }`,
              backgroundColor: !bankCode ? 'var(--bg-subtle, #f8fafc)' : 'var(--surface, #ffffff)',
              color: 'var(--text-primary, #17231d)',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.05em',
              outline: 'none'
            }}
          />

          <div
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {isResolving && <Loader2 size={18} className="spin" color="var(--primary, #0B6B3A)" />}
            {!isResolving && isVerified && <CheckCircle2 size={18} color="var(--success, #16a34a)" />}
            {!isResolving && resolveError && <AlertCircle size={18} color="var(--error, #dc2626)" />}
          </div>
        </div>

        {!bankCode && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary, #64748b)', marginTop: 4 }}>
            Please select your bank first.
          </span>
        )}
      </div>

      {/* Account Verification Feedback */}
      {isResolving && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            backgroundColor: 'rgba(11, 107, 58, 0.08)',
            color: 'var(--primary, #0B6B3A)',
            fontSize: 13
          }}
        >
          <Loader2 size={15} className="spin" />
          <span>Verifying account details with Paystack...</span>
        </div>
      )}

      {isVerified && !isResolving && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: 'rgba(22, 163, 74, 0.1)',
            border: '1px solid rgba(22, 163, 74, 0.3)'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={16} color="var(--success, #16a34a)" />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success, #15803d)' }}>
                {accountName}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-secondary, #4b5563)', marginTop: 2, display: 'block' }}>
              {isManualConfirmed ? 'Manual confirmed recipient' : 'Verified Paystack account holder'}
            </span>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              backgroundColor: '#dcfce7',
              color: '#166534'
            }}
          >
            Verified
          </span>
        </div>
      )}

      {resolveError && !isResolving && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.25)',
            fontSize: 12,
            color: 'var(--error, #b91c1c)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <AlertCircle size={15} />
            <span>{resolveError}</span>
          </div>

          {allowManualFallback && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(220, 38, 38, 0.2)' }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary, #4b5563)' }}>
                Resolution service unavailable? You may enter your exact registered bank account name manually:
              </p>
              <input
                type="text"
                placeholder="Enter exact account name"
                value={accountName}
                onChange={(e) => handleManualNameChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #d1d5db)',
                  fontSize: 13
                }}
              />
              <span style={{ display: 'block', fontSize: 11, color: '#b45309', marginTop: 4 }}>
                ⚠️ Warning: Double check your account number and name. Incorrect details will cause transfer failure.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BankResolutionInput;
