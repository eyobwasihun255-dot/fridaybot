import React from 'react';
import { useLanguageStore } from '../store/languageStore';

interface BingoGridProps {
  cardNumbers: number[][];
  calledNumbers: number[];
  onNumberClick: (number: number) => void;
  markedNumbers: Set<number>;
}

const BingoGrid: React.FC<BingoGridProps> = ({
  cardNumbers,
  calledNumbers,
  onNumberClick,
  markedNumbers
}) => {
  const { t } = useLanguageStore();

  const columnHeaders = ['B', 'I', 'N', 'G', 'O'];
  
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-5 bg-gradient-to-r from-purple-600 to-blue-600">
        {columnHeaders.map((header, index) => (
          <div key={header} className="p-3 text-center">
            <span className="text-white font-bold text-lg">{header}</span>
            <div className="text-white/80 text-xs mt-1">
              {t(`${header.toLowerCase()}_column`)}
            </div>
          </div>
        ))}
      </div>
      
      {/* Grid */}
      <div className="grid grid-cols-5">
        {cardNumbers.map((row, rowIndex) =>
          row.map((number, colIndex) => {
            const isFreeSpace = rowIndex === 2 && colIndex === 2;
            const isCalled = calledNumbers.includes(number);
            const isMarked = markedNumbers.has(number);
            
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                onClick={() => !isFreeSpace && onNumberClick(number)}
                disabled={isFreeSpace}
                className={`
                  aspect-square p-4 border border-gray-200 flex items-center justify-center font-bold text-lg transition-all duration-200
                  ${isFreeSpace
                    ? 'bg-theme-light text-theme-primary cursor-default'
                    : isCalled && isMarked
                    ? 'bg-theme-primary text-white shadow-inner'
                    : isCalled
                    ? 'bg-theme-accent text-theme-primary hover:bg-theme-secondary'
                    : isMarked
                    ? 'bg-theme-secondary text-white'
                    : 'bg-white text-gray-800 hover:bg-theme-light/50'
                  }
                `}
              >
                {isFreeSpace ? 'FREE' : number}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default BingoGrid;