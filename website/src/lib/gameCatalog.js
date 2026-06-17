const genericCategories = [
  'Clutch',
  'Funny',
  'Build',
  'Ranked',
  'Speedrun',
  'Reaction'
];

export const gameCatalog = [
  { title: 'Valorant', icon: 'V', categories: ['Ace', 'Clutch', 'Lineup', 'Ranked', 'Funny'] },
  { title: 'League of Legends', icon: 'L', categories: ['Outplay', 'Teamfight', 'Penta', 'Ranked', 'Guide'] },
  { title: 'Counter-Strike 2', icon: 'CS', categories: ['Ace', 'Clutch', 'Utility', 'Ranked', 'Funny'] },
  { title: 'Fortnite', icon: 'F', categories: ['Victory Royale', 'Build Fight', 'Movement', 'Funny', 'Ranked'] },
  { title: 'Minecraft', icon: 'MC', categories: ['Build', 'Parkour', 'Survival', 'Funny', 'Guide'] },
  { title: 'Rocket League', icon: 'RL', categories: ['Goal', 'Save', 'Freestyle', 'Ranked', 'Funny'] },
  { title: 'Apex Legends', icon: 'A', categories: ['Squad Wipe', 'Clutch', 'Movement', 'Ranked', 'Funny'] },
  { title: 'Call of Duty', icon: 'COD', categories: ['Killstreak', 'Clutch', 'Sniping', 'Ranked', 'Funny'] },
  { title: 'Overwatch 2', icon: 'OW', categories: ['Play of the Game', 'Clutch', 'Support Save', 'Ranked', 'Funny'] },
  { title: 'Roblox', icon: 'R', categories: ['Win', 'Funny', 'Obby', 'Build', 'Challenge'] },
  { title: 'Marvel Rivals', icon: 'MR', categories: ['Highlight', 'Combo', 'Teamfight', 'Ranked', 'Funny'] },
  { title: 'World of Warcraft', icon: 'WOW', categories: ['Raid', 'PvP', 'Boss Fight', 'Mythic+', 'Funny'] },
  { title: 'Destiny 2', icon: 'D2', categories: ['Raid', 'PvP', 'Movement', 'Boss Fight', 'Funny'] },
  { title: 'Helldivers 2', icon: 'HD', categories: ['Mission', 'Save', 'Funny', 'Co-op', 'Clutch'] },
  { title: 'Brawlhalla', icon: 'B', categories: ['Combo', 'Clutch', 'Ranked', 'Funny', 'Tournament'] },
  { title: 'Grand Theft Auto V', icon: 'GTA', categories: ['Heist', 'Funny', 'Stunt', 'Race', 'Roleplay'] },
  { title: 'Rust', icon: 'R', categories: ['Raid', 'Clutch', 'Funny', 'Base Build', 'PvP'] },
  { title: 'War Thunder', icon: 'WT', categories: ['Dogfight', 'Tank Duel', 'Funny', 'Ranked', 'Guide'] },
  { title: 'Dota 2', icon: 'D2', categories: ['Teamfight', 'Outplay', 'Rampage', 'Ranked', 'Guide'] },
  { title: 'Among Us', icon: 'AU', categories: ['Funny', 'Impostor', 'Clutch', 'Friend Lobby', 'Guide'] },
  { title: 'Fall Guys', icon: 'FG', categories: ['Win', 'Funny', 'Clutch', 'Party', 'Challenge'] },
  { title: 'Elden Ring', icon: 'ER', categories: ['Boss Fight', 'Build', 'Funny', 'Challenge', 'Speedrun'] },
  { title: 'Hades II', icon: 'H2', categories: ['Boss Fight', 'Build', 'Speedrun', 'Funny', 'Guide'] },
  { title: 'The Finals', icon: 'TF', categories: ['Clutch', 'Objective', 'Movement', 'Funny', 'Ranked'] }
];

export const featuredGames = gameCatalog.map((game) => game.title);

export const defaultGameTitle = gameCatalog[0].title;

const DEFAULT_GAME_ICON = 'G';

export function gameIconForTitle(gameTitle) {
  return gameCatalog.find((game) => game.title === gameTitle)?.icon || DEFAULT_GAME_ICON;
}

export function gameDisplayNameWithIcon(gameTitle) {
  return `[${gameIconForTitle(gameTitle)}] ${gameTitle}`;
}

export function categoriesForGame(gameTitle) {
  return gameCatalog.find((game) => game.title === gameTitle)?.categories || genericCategories;
}