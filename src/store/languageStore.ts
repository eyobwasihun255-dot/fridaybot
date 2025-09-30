import { create } from 'zustand';

type Language = 'am' | 'en';

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations = {
    am: {
    // Header
    // Add inside 'am' block
'insufficient_balance': ' በቂ ገንዘብ የለም!',
'bet_placed': 'ውርርድ ተደርጓል! ለሌሎች ተጫዋቾች ይጠብቁ...',
'error_player_card': 'ስህተት: ተጫዋች/ካርድ አልተገኘም',
'already_attempted_bingo': 'ቢንጎ አስቀድሞ ሞክረዋል!',
'bingo_not_allowed': 'ቢንጎ የማይፈቀድ ነው።',
'not_a_winner': 'አሸናፊ አይደሉም።',
'cancel_failed': 'አልተሳካም።',

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
    'you_lost': 'ይቅርታ! ተሸንፈዋል!',
    // Room
    bingo_rules_countdown: [
        "የተጠሩትን ቁጥሮች ካርቴላ ላይ ካሉት ቁጥሮች ጋር ማዛመድይጫኑ",
        "እያሸነፍክ እንደሆነ እርግጠኛ ከሆንክ ብቻ 'ቢንጎ' ይጫኑ",
        "ቁጥር ሳይወጣለት ቢንጎን የተጫነ ማንኛውም ተጫዋች  ካርቴላው ውድቅ ይሆናል።",
        "ጨዋታ ሲጀምር መደብ ይቆማል።",
        "አሸናፊዎች Bingo ከተረጋገጠ በኋላ ደራሽ ወደ ሂሳብ ይገባል።"
      ],
      bingo_rules_ended: [
        "ካርቴዎን አስተያየተው'ቢንጎ' ይጫኑ።"
      ],
    'room_details': 'ክፍል',
    'payout': 'ደራሽ',
    'max_players': 'ከፍተኛ ተጫዋቾች',
    'game_area': 'የጨዋታ አካባቢ',
    'select_card': 'ካርቴላ ይምረጡ 👉',
    'card_number': 'ካርቴላ #',
    'place_bet': 'ውርርድ ያድርጉ',
    'bingo': 'ቢንጎ!',
    'numbers_called': 'የተጠሩ ቁጥሮች',
    'waiting_players': 'በመጠበቅ..',
    'game_starts_in': 'ጨዋታ ይጀምራል በ',
    'seconds': 'ሰከንዶች',
    'you_won': 'እንኳን ደስ አለዎት! አሸንፈዋል!',
    'game_ended': 'ጨዋታ ተጠናቋል። አዲስ ዙር እየጀመረ...',
    
    // Game
    'b_column': 'ቢ (1-15)',
    'i_column': 'ኣይ (16-30)',
    'n_column': 'ኤን (31-45)',
    'g_column': 'ጂ (46-60)',
    'o_column': 'ኦ (61-75)',
     'countdown': 'ቆጠራ',
    'waiting_for_players': 'ለተጫዋቾች በመጠበቅ...',
    'game_in_progress': 'ጨዋታ በሂደት ላይ ነው',
    'place_your_bet': 'ውርርድዎን ያድርጉ',
    'playing' : 'በመጫዋታ ላይ',
     'ended' : 'ተጠናቋል',
     
    // General
    'loading': 'በመጫን ላይ...',
    'error': 'ስህተት ተከስቷል',
    'success': 'ተሳክቷል!',
    'confirm': 'አረጋግጥ',
    'cancel': 'ሰርዝ',
    'cards': 'ካርቴላ',
    'card': 'ካርቴላ',
    'winner': 'አሸናፊ',
    'players_in_room': 'ተጫዋቾች ',
    'no_card_selected': 'ካርቴላ አልተመረጠም...',
    'game_already_in_progress': 'ጨዋታ በሂደት ላይ ነው',
    'home': 'back',
    'set_auto_bet': 'auto ውርርድ ያድርጉ',
    'remove_auto_bet': 'auto ውርርድ ሰርዝ',
    'auto_bet_en': 'Auto Bet ለካርቴላ ተደርጓል',
    'auto_bet_dis': 'Auto Bet ከካርቴላ ተሰርዟል',
    'etb': 'ብር'
  },en: {
    // Header
    'etb' :'ETB',
    'auto_bet_en': 'Auto Bet enabled for card',
    'auto_bet_dis': 'Auto Bet disabled for card',
    'set_auto_bet': 'Set Auto Bet',
    'remove_auto_bet': 'Remove Auto Bet',
    'home': 'back',
    'cards': 'Card',
    'friday_bingo': 'Friday Bingo',
    'balance': 'Balance',
     bingo_rules_countdown: [
        "Mark your numbers as they are called.",
        "Click 'Bingo' only when you have at least one pattern.",
         "Any player who pressed Bingo without a valid pattern will be disqualified.",
        "Betting is locked once the game starts.",
        "Winners are paid automatically after verification."
      ],
      bingo_rules_ended: [
        "Check your cards and press Bingo."
      ],
      'players_in_room': 'Players in this room',
      'no_card_selected': 'No card selected yet...',
      'game_already_in_progress': 'Game already in progress',
    'bet': 'Bet',
    'pattern': 'Winning Patterns',
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
    'you_lost': 'Sorry! You lost!',
    // Room
    'room_details': 'Room',
    'payout': 'Payout',
    'max_players': 'Max Players',
    'game_area': 'Game Area',
    'select_card': 'Select Your Card 👉',
    'card_number': 'Card #',
    'bingo': 'BINGO!',
    'numbers_called': 'Numbers Called',
    'waiting_players': 'Waiting ...',
    'game_starts_in': 'Game starts in',
    'seconds': 'seconds',
    'you_won': 'Congratulations! You won!',
    'not_a_winner': 'Not a winner this time.',
    'card': 'Card',
    'winner': 'is the WINNER',
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
    'insufficient_balance': 'Insufficient balance!',
    'bet_placed': 'Bet placed! Waiting for other players...',
    'error_player_card': 'Error: player/card not found',
    'already_attempted_bingo': 'You already attempted Bingo!',
    'bingo_not_allowed': 'No Bingo allowed now.',
    'cancel_failed': 'Cancel failed.',
    'game_in_progress': 'Game is currently in progress',
  }
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: 'am',
  
  setLanguage: (lang: Language) => {
    set({ language: lang });
  },
  
  t: (key: string) => {
    const { language } = get();
    return translations[language][key] || key;
  }
}));