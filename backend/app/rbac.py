"""Role-based access control: the server-side source of truth.

Roles (per business membership):
  - owner      : full access
  - accountant : add/edit entries + view everything + reports & export; no delete,
                 no settings, no team management
  - staff      : add entries only (no lists, reports, settings, edit or delete)

Permissions are checked from the caller's *live* membership role on every request
(never trusted from the client or baked into the token, so a role change or
removal takes effect immediately).
"""

# --- Permission keys --------------------------------------------------------
ENTRY_CREATE = "entry.create"  # add income/expense/ledger/customer
ENTRY_EDIT = "entry.edit"      # edit entries/customers
ENTRY_DELETE = "entry.delete"  # delete entries/customers
DATA_VIEW = "data.view"        # dashboard, transactions, customer lists, khata
REPORTS_VIEW = "reports.view"  # view reports
REPORTS_EXPORT = "reports.export"
SETTINGS_MANAGE = "settings.manage"  # items, recurring, business config
TEAM_MANAGE = "team.manage"    # invite / change role / remove members

ALL_PERMISSIONS = {
    ENTRY_CREATE,
    ENTRY_EDIT,
    ENTRY_DELETE,
    DATA_VIEW,
    REPORTS_VIEW,
    REPORTS_EXPORT,
    SETTINGS_MANAGE,
    TEAM_MANAGE,
}

ROLES = ("owner", "accountant", "staff")

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": set(ALL_PERMISSIONS),
    "accountant": {
        ENTRY_CREATE,
        ENTRY_EDIT,
        DATA_VIEW,
        REPORTS_VIEW,
        REPORTS_EXPORT,
    },
    "staff": {ENTRY_CREATE},
}


def role_can(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
