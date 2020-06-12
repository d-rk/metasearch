// These definitions are declared as ambient so that they can be easily shared
// between frontend and backend code

interface Engine {
  id: string;
  init: (options: object) => void | Promise<void>;
  search: (q: string) => Promise<Result[]>;
}

interface Result {
  snippet?: string;
  title: string;
  url: string;
}