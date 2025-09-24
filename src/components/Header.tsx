import React, { useEffect, useState } from 'react';
import { Zap, Coins, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore'; 
import LanguageToggle from './LanguageToggle';

const Header: React.FC = () => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(false);

  const handleReloadClick = async () => {
    // optional fallback reload
    setLoading(true);
    await useAuthStore.getState().reloadBalance();
    setLoading(false);
  };

  return (
    <header className="fixed top-0 left-0 right-0 bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-md bg-opacity-90 z-50 border-b border-white/20">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            <span className="text-white font-bold text-lg">{t('friday_bingo')}</span>
          </div>

          <div className="flex items-center space-x-4">
            <LanguageToggle />

            <div className="flex items-center space-x-2 bg-white/10 rounded-lg px-3 py-1.5">
              <Coins className="w-4 h-4 text-yellow-400" />
              <span className="text-white font-medium">
                {typeof user?.balance === "number"
                  ? user.balance.toFixed(2) + " ETB"
                  : "0.00 ETB"}
              </span>
              <button
                onClick={handleReloadClick}
                disabled={loading}
                className="ml-2 p-1 rounded hover:bg-white/20"
              >
                <RefreshCw
                  className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            <div className="text-white text-sm">
              <div className="font-medium">{user?.username}</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
export default Header;