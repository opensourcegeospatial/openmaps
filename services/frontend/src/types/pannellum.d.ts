declare module 'pannellum/build/pannellum.js' {
  const pannellum: {
    viewer: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  };
  export default pannellum;
}

declare module 'pannellum/build/pannellum.css';

interface Window {
  pannellum?: {
    viewer: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  };
}
