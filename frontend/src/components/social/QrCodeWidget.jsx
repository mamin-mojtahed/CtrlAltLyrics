import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QrCode, X, Copy, Check, Users, ExternalLink } from 'lucide-react';
import { useSocialStore } from '../../stores/useSocialStore';

export default function QrCodeWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const miniCanvasRef = useRef(null);
  const expandedCanvasRef = useRef(null);
  const widgetRef = useRef(null);

  const networkInfo = useSocialStore((state) => state.networkInfo);
  const guestCount = useSocialStore((state) => state.guestCount);
  const initSocialSync = useSocialStore((state) => state.initSocialSync);

  useEffect(() => {
    // Explicitly pass false: Display tab is never a guest client!
    initSocialSync(false);
  }, []);

  // Compute best reachable guest URL:
  // If running in browser and hostname is not localhost, use current host,
  // else use detected LAN IP from networkInfo so mobile on Wi-Fi works!
  const guestUrl = (() => {
    if (typeof window !== 'undefined') {
      const { protocol, host, hostname, port } = window.location;
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return `${protocol}//${host}/guest.html`;
      }
      if (networkInfo?.ip && networkInfo.ip !== 'localhost' && networkInfo.ip !== '127.0.0.1') {
        const p = port ? `:${port}` : '';
        return `${protocol}//${networkInfo.ip}${p}/guest.html`;
      }
      return `${protocol}//${host}/guest.html`;
    }
    return networkInfo?.guestUrl || '/guest.html';
  })();

  // Render smaller full visible QR code when minimized
  useEffect(() => {
    if (isOpen || !miniCanvasRef.current) return;
    try {
      QRCode.toCanvas(
        miniCanvasRef.current,
        guestUrl,
        {
          width: 72,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        },
        (err) => {
          if (err) console.error('Mini QR code render error:', err);
        }
      );
    } catch (err) {
      console.error('Failed to generate mini QR code canvas:', err);
    }
  }, [isOpen, guestUrl]);

  // Render large QR code canvas when expanded
  useEffect(() => {
    if (!isOpen || !expandedCanvasRef.current) return;
    try {
      QRCode.toCanvas(
        expandedCanvasRef.current,
        guestUrl,
        {
          width: 184,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        },
        (err) => {
          if (err) console.error('Expanded QR code render error:', err);
        }
      );
    } catch (err) {
      console.error('Failed to generate expanded QR code canvas:', err);
    }
  }, [isOpen, guestUrl]);

  // Keyboard shortcut: Press 'q' or 'Q' to toggle QR Code; Escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Click outside to collapse
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(guestUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  return (
    <div
      ref={widgetRef}
      className={`display-qr-widget ${isOpen ? 'expanded' : 'collapsed'}`}
    >
      {!isOpen ? (
        <div
          className="qr-mini-badge glass"
          onClick={() => setIsOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(true);
            }
          }}
          title="Party QR Code (Press Q)"
          aria-label="Party QR Code"
        >
          <div className="qr-mini-canvas-wrap">
            <canvas ref={miniCanvasRef} className="qr-mini-canvas" />
          </div>
        </div>
      ) : (
        <div
          className="qr-expanded-card glass"
          role="dialog"
          aria-modal="true"
          aria-label="Party QR Code and Access"
        >
          <div className="qr-card-header">
            <div className="qr-card-title">
              <QrCode size={18} className="qr-accent-icon" />
              <span>Join Karaoke Party</span>
            </div>
            <button
              className="qr-close-btn"
              onClick={() => setIsOpen(false)}
              title="Close (Q or Esc)"
              aria-label="Close QR Code"
            >
              <X size={16} />
            </button>
          </div>

          <div className="qr-canvas-wrapper">
            <canvas ref={expandedCanvasRef} className="qr-canvas" />
          </div>

          {/* Revealed Link Row */}
          <div className="qr-url-row">
            <a
              href={guestUrl}
              target="_blank"
              rel="noreferrer"
              className="qr-url-link"
              title={`Open ${guestUrl} in new tab`}
            >
              <span className="qr-url-text">{guestUrl}</span>
              <ExternalLink size={12} className="qr-ext-icon" />
            </a>
            <button
              className="qr-copy-btn"
              onClick={handleCopyLink}
              title={copied ? 'Copied to clipboard!' : 'Copy Link'}
              aria-label="Copy guest URL"
            >
              {copied ? <Check size={14} className="copied-icon" /> : <Copy size={14} />}
            </button>
          </div>

          {/* Revealed People Counter: Icon and sum number only */}
          <div className="qr-card-footer">
            <div className="qr-roster-count-box">
              <div className="qr-roster-pill" title={`${guestCount} connected`}>
                <Users size={15} className="qr-roster-icon" />
                <span className="qr-roster-number">{guestCount}</span>
              </div>
            </div>
            <span className="qr-hint">Scan with phone camera or visit link to request songs</span>
          </div>
        </div>
      )}
    </div>
  );
}
