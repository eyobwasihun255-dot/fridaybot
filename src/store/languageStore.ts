import { create } from 'zustand';

type Language = 'en' | 'am';

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations = {
  en: {
    // Header
    'friday_bingo': 'Friday Bingo',
    'balance': 'Balance',
    
    // Landing
    'welcome': 'Welcome to Friday Bingo!',
    'available_rooms': 'Available Rooms',
    'demo_room': 'Demo Room',
    'free_play': 'Free Play',
    'bet_amount': 'Bet Amount',
    'players': 'Players',
    'status': 'Status',
    'active': 'Active',
    'waiting': 'Waiting ',
    'in_progress': 'In Progress',
    'join_room': 'Join Room',
    'cancel_bet':'Cancel bet',
    'place_bet':'Place bet',
    
    // Room
    'room_details': 'Room',
    'bet': 'Bet',
    'payout': 'Payout',
    'max_players': 'Max Players',
    'game_area': 'Game Area',
    'select_card': 'Select Your Card',
    'card_number': 'Card #',
    'bingo': 'BINGO!',
    'numbers_called': 'Numbers Called',
    'waiting_players': 'Waiting ...',
    'game_starts_in': 'Game starts in',
    'seconds': 'seconds',
    'you_won': 'Congratulations! You won!',
    'not_a_winner': 'Not a winner this time.',
    'game_ended': 'Game ended. Starting new round...',
    
    // Game
    'b_column': 'B (1-15)',
    'i_column': 'I (16-30)',
    'n_column': 'N (31-45)',
    'g_column': 'G (46-60)',
    'o_column': 'O (61-75)',
    
    // General
    'loading': 'Loading...',
    'error': 'An error occurred',
    'success': 'Success!',
    'confirm': 'Confirm',
    'cancel': 'Cancel',
    'pattern': 'Winning Patterns'
  },
  am: {
    // Header
    'friday_bingo': 'Friday Bingo',
    'balance': 'ሂሳብ',
    'bet': 'መደብ',
    'pattern': 'የማሸነፍ መንገዶች',
    // Landing
    'welcome': 'ወደ Friday Bingo እንኳን በደህና መጡ!',
    'available_rooms': 'ያሉ ክፍሎች',
    'demo_room': 'ሙከራ ክፍል',
    'free_play': 'ነጻ ጨዋታ',
    'bet_amount': 'የውርርድ መጠን',
    'players': 'ተጫዋቾች',
    'status': 'ሁኔታ',
    'active': 'Active',
    'waiting': 'በመጠበቅ..',
    'in_progress': 'በሂደት ላይ',
    'join_room': 'ክፍል ግባ',
    'cancel_bet':'ውርርድ ሰርዝ',
    // Room
    'room_details': 'ክፍል',
    'payout': 'ደራሽ',
    'max_players': 'ከፍተኛ ተጫዋቾች',
    'game_area': 'የጨዋታ አካባቢ',
    'select_card': 'ካርድዎን ይምረጡ',
    'card_number': 'ካርድ #',
    'place_bet': 'ውርርድ ያድርጉ',
    'bingo': 'ቢንጎ!',
    'numbers_called': 'የተጠሩ ቁጥሮች',
    'waiting_players': 'በመጠበቅ..',
    'game_starts_in': 'ጨዋታ ይጀምራል በ',
    'seconds': 'ሰከንዶች',
    'you_won': 'እንኳን ደስ አለዎት! አሸንፈዋል!',
    'not_a_winner': 'በዚህ ጊዜ አሸናፊ አይደሉም።',
    'game_ended': 'ጨዋታ ተጠናቋል። አዲስ ዙር እየጀመረ...',
    
    // Game
    'b_column': 'ቢ (1-15)',
    'i_column': 'ኣይ (16-30)',
    'n_column': 'ኤን (31-45)',
    'g_column': 'ጂ (46-60)',
    'o_column': 'ኦ (61-75)',
    
    // General
    'loading': 'በመጫን ላይ...',
    'error': 'ስህተት ተከስቷል',
    'success': 'ተሳክቷል!',
    'confirm': 'አረጋግጥ',
    'cancel': 'ሰርዝ'
  }
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: 'en',
  
  setLanguage: (lang: Language) => {
    set({ language: lang });
  },
  
  t: (key: string) => {
    const { language } = get();
    return translations[language][key] || key;
  }
}));