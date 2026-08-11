// Original skill-router CLI logo — pure ASCII, renders on every terminal.
export const LOGO = String.raw`
   ____  _  ___  ___  _    _  _____ _____  _  ___  _____ _____
  / ___|| |/ _ \|_ _|| |  | || ____|_   _|/ |/ _ \| ____|_   _|
  \___ \| | |_| || | | |__| ||  _|   | | | | | |_| |  _|   | |
   ___) | |  _  || | |  __  || |___  | | | | |  _  | |___  | |
  |____/|_|_| |_|___||_|  |_||_____| |_| |_| |_| |_|_____| |_|

  skill-router - route any request to the right agent skills
`;

export function banner() {
  return LOGO;
}
