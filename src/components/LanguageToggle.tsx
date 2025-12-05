import React from 'react';
import { useLanguageStore } from '../store/languageStore';

const LanguageToggle: React.FC = () => {
  const { language, setLanguage } = useLanguageStore();

  return (
    <div className="flex items-center bg-white/10 rounded-lg p-1">
      {/* Amharic */}
      <button
        onClick={() => setLanguage('am')}
        className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
          language === 'am'
            ? 'bg-white text-blue-600 shadow-sm'
            : 'text-white/80 hover:text-white'
        }`}
      >
        🇪🇹 አማ
      </button>

      {/* Oromo with Oromia Flag */}
      <button
        onClick={() => setLanguage('om')}
        className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
          language === 'om'
            ? 'bg-white text-blue-600 shadow-sm'
            : 'text-white/80 hover:text-white'
        }`}
      >
        <img
          src="/images/download.png"
          alt="Oromia Flag"
          className="inline-block w-4 h-3 mr-1 rounded-sm object-cover"
        />
        OR
      </button>

      {/* English */}
      <button
        onClick={() => setLanguage('en')}
        className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
          language === 'en'
            ? 'bg-white text-blue-600 shadow-sm'
            : 'text-white/80 hover:text-white'
        }`}
      >
        🇬🇧 EN
      </button>
    </div>
  );
};

export default LanguageToggle;
