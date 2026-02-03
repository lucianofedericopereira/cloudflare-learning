/**
 * HTML templates for profile pages
 */

interface User {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string;
}

interface Link {
  id: string;
  title: string;
  url: string;
  icon: string | null;
}

const themes: Record<string, { bg: string; card: string; text: string; accent: string }> = {
  default: {
    bg: "bg-gray-100",
    card: "bg-white",
    text: "text-gray-900",
    accent: "hover:bg-gray-50",
  },
  dark: {
    bg: "bg-gray-900",
    card: "bg-gray-800",
    text: "text-white",
    accent: "hover:bg-gray-700",
  },
  gradient: {
    bg: "bg-gradient-to-br from-purple-600 to-blue-500",
    card: "bg-white/90 backdrop-blur",
    text: "text-gray-900",
    accent: "hover:bg-white",
  },
  sunset: {
    bg: "bg-gradient-to-br from-orange-500 to-pink-500",
    card: "bg-white/90 backdrop-blur",
    text: "text-gray-900",
    accent: "hover:bg-white",
  },
  forest: {
    bg: "bg-gradient-to-br from-green-600 to-teal-500",
    card: "bg-white/90 backdrop-blur",
    text: "text-gray-900",
    accent: "hover:bg-white",
  },
};

export function renderProfilePage(user: User, links: Link[]): string {
  const theme = themes[user.theme] || themes.default;
  const displayName = user.display_name || user.username;
  const avatarUrl = user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;

  const linksHtml = links
    .map(
      (link) => `
        <a href="/go/${link.id}"
           class="block w-full p-4 rounded-xl ${theme.card} ${theme.text} ${theme.accent}
                  shadow-lg transition-all duration-200 transform hover:scale-105 hover:shadow-xl">
          <div class="flex items-center justify-center gap-3">
            ${link.icon ? `<span class="text-xl">${escapeHtml(link.icon)}</span>` : ""}
            <span class="font-medium">${escapeHtml(link.title)}</span>
          </div>
        </a>
      `
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(displayName)} | Link in Bio</title>
  <meta name="description" content="${escapeHtml(user.bio || `Check out ${displayName}'s links`)}">
  <meta property="og:title" content="${escapeHtml(displayName)}">
  <meta property="og:description" content="${escapeHtml(user.bio || `Check out ${displayName}'s links`)}">
  <meta property="og:image" content="${escapeHtml(avatarUrl)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body { font-family: 'Inter', sans-serif; }
  </style>
</head>
<body class="${theme.bg} min-h-screen">
  <div class="min-h-screen flex flex-col items-center justify-start py-12 px-4">
    <div class="w-full max-w-md space-y-6">
      <!-- Profile Header -->
      <div class="text-center">
        <img
          src="${escapeHtml(avatarUrl)}"
          alt="${escapeHtml(displayName)}"
          class="w-24 h-24 rounded-full mx-auto mb-4 shadow-lg border-4 border-white"
        />
        <h1 class="${theme.text === "text-white" ? "text-white" : "text-gray-900"} text-2xl font-bold">
          ${escapeHtml(displayName)}
        </h1>
        <p class="${theme.text === "text-white" ? "text-gray-300" : "text-gray-600"} text-sm mt-1">
          @${escapeHtml(user.username)}
        </p>
        ${
          user.bio
            ? `<p class="${theme.text === "text-white" ? "text-gray-300" : "text-gray-600"} mt-3 text-sm max-w-xs mx-auto">
                ${escapeHtml(user.bio)}
              </p>`
            : ""
        }
      </div>

      <!-- Links -->
      <div class="space-y-3">
        ${linksHtml || '<p class="text-center text-gray-500">No links yet</p>'}
      </div>

      <!-- Footer -->
      <div class="text-center pt-8">
        <a href="/" class="${theme.text === "text-white" ? "text-gray-400" : "text-gray-500"} text-xs hover:underline">
          Powered by Cloudflare Workers
        </a>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function renderNotFoundPage(username: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Not Found</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-6xl font-bold text-gray-300">404</h1>
    <p class="text-xl text-gray-600 mt-4">User @${escapeHtml(username)} not found</p>
    <a href="/" class="mt-6 inline-block text-blue-500 hover:underline">Go Home</a>
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
