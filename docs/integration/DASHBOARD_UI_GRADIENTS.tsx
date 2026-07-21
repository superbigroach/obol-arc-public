/**
 * Obol Dashboard - Bold Modern Gradient Buttons
 * For: obol-arc.web.app / Arc hackathon dashboard
 *
 * Design: Option 3 (Bold & Modern)
 * - Get testnet USDC: Lime (#51cf66) → Emerald (#0ca678)
 * - Withdraw: Violet (#9775fa) → Pink (#f06595)
 *
 * Location: Left side of wallet address row
 */

import React, { useState } from 'react';

export const ObolWalletActions = () => {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  return (
    <div className="w-full space-y-4">
      {/* Wallet Address Row */}
      <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex-1">
          <p className="text-sm text-gray-600">Agent Wallet Address</p>
          <p className="text-lg font-mono font-semibold text-gray-900">
            0x1234...5678
          </p>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center gap-3">
          {/* Get Testnet USDC Button - Lime to Emerald */}
          <button
            onClick={() => {/* Call get testnet USDC endpoint */}}
            className="px-4 py-2 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #51cf66 0%, #0ca678 100%)',
              boxShadow: '0 4px 15px rgba(81, 207, 102, 0.3)',
            }}
          >
            Get testnet USDC
          </button>

          {/* Withdraw Button - Violet to Pink */}
          <button
            onClick={() => setIsWithdrawing(!isWithdrawing)}
            className="px-4 py-2 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #9775fa 0%, #f06595 100%)',
              boxShadow: '0 4px 15px rgba(151, 117, 250, 0.3)',
            }}
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Withdraw Modal - Only show when button clicked */}
      {isWithdrawing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Withdraw USDC</h2>

            <div className="space-y-4">
              {/* Amount Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
                />
              </div>

              {/* Address Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Address (0x...)
                </label>
                <input
                  type="text"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none font-mono text-sm"
                />
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                ℹ️ Requires 2FA confirmation. You'll be prompted after clicking "Confirm".
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsWithdrawing(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {/* Call withdrawUserWallet CF */}}
                  className="flex-1 px-4 py-2 rounded-lg font-semibold text-white transition-all hover:shadow-lg active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, #9775fa 0%, #f06595 100%)',
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Export for Tailwind gradient configuration
export const GRADIENT_COLORS = {
  getTestnetUSDC: {
    gradient: 'linear-gradient(135deg, #51cf66 0%, #0ca678 100%)',
    shadowColor: 'rgba(81, 207, 102, 0.3)',
    hoverScale: 'hover:scale-105',
    colors: {
      start: '#51cf66', // Lime green
      end: '#0ca678',   // Emerald green
    }
  },
  withdraw: {
    gradient: 'linear-gradient(135deg, #9775fa 0%, #f06595 100%)',
    shadowColor: 'rgba(151, 117, 250, 0.3)',
    hoverScale: 'hover:scale-105',
    colors: {
      start: '#9775fa', // Violet
      end: '#f06595',   // Pink
    }
  }
};

// Standalone component - just the buttons
export const WalletActionButtons = () => {
  return (
    <div className="flex items-center gap-3">
      {/* Get Testnet USDC Button - Lime to Emerald */}
      <button
        className="px-4 py-2 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:scale-105 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #51cf66 0%, #0ca678 100%)',
          boxShadow: '0 4px 15px rgba(81, 207, 102, 0.3)',
        }}
      >
        Get testnet USDC
      </button>

      {/* Withdraw Button - Violet to Pink */}
      <button
        className="px-4 py-2 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:scale-105 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #9775fa 0%, #f06595 100%)',
          boxShadow: '0 4px 15px rgba(151, 117, 250, 0.3)',
        }}
      >
        Withdraw
      </button>
    </div>
  );
};
