/**
 * Role-Based Access Control (RBAC)
 */

interface Permission {
  resource: string;
  actions: ("create" | "read" | "update" | "delete")[];
}

interface Role {
  name: string;
  permissions: Permission[];
}

// Define roles and their permissions
const roles: Record<string, Role> = {
  admin: {
    name: "admin",
    permissions: [
      { resource: "*", actions: ["create", "read", "update", "delete"] },
    ],
  },
  moderator: {
    name: "moderator",
    permissions: [
      { resource: "users", actions: ["read"] },
      { resource: "posts", actions: ["read", "update", "delete"] },
      { resource: "comments", actions: ["read", "update", "delete"] },
    ],
  },
  user: {
    name: "user",
    permissions: [
      { resource: "profile", actions: ["read", "update"] },
      { resource: "posts", actions: ["create", "read"] },
      { resource: "comments", actions: ["create", "read"] },
    ],
  },
};

export function hasPermission(
  roleName: string,
  resource: string,
  action: "create" | "read" | "update" | "delete"
): boolean {
  const role = roles[roleName];
  if (!role) return false;

  for (const permission of role.permissions) {
    // Check if resource matches (wildcard or exact)
    const resourceMatches =
      permission.resource === "*" || permission.resource === resource;

    // Check if action is allowed
    const actionAllowed = permission.actions.includes(action);

    if (resourceMatches && actionAllowed) {
      return true;
    }
  }

  return false;
}

export function getPermissions(roleName: string): Permission[] {
  const role = roles[roleName];
  return role?.permissions || [];
}

export function getAllRoles(): string[] {
  return Object.keys(roles);
}

export function getRoleDetails(roleName: string): Role | null {
  return roles[roleName] || null;
}
