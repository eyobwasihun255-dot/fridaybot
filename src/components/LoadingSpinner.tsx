import React from 'react';
import { useLanguageStore } from '../store/languageStore';

const LoadingSpinner: React.FC = () => {
  const { t } = useLanguageStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-800 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
        <p className="text-white text-lg">{t('loading')}</p>
      </div>
    </div>
  );
};

export default LoadingSpinner;