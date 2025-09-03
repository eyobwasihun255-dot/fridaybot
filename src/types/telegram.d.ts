declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready(): void;
        initDataUnsafe: {
          user?: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
          };
        };
        MainButton: {
          show(): void;
          hide(): void;
          setText(text: string): void;
          onClick(callback: () => void): void;
        };
        BackButton: {
          show(): void;
          hide(): void;
          onClick(callback: () => void): void;
        };
        expand(): void;
        close(): void;
      };
    };
  }
}

export {};