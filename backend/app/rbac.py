"""Role-based access control: the server-side source of truth.

Roles (per business membership):
  - owner      : full access
  - accountant : READ-ONLY — view ledgers, ageing, daily close, GST reports and
                 export (CA/Tally). Cannot add, edit, delete or reverse entries,
                 change settings/prices/roles/staff, or invite anyone.
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
BEATS_MANAGE = "beats.manage"  # create beats, assign staff, order retailers

ALL_PERMISSIONS = {
    ENTRY_CREATE,
    ENTRY_EDIT,
    ENTRY_DELETE,
    DATA_VIEW,
    REPORTS_VIEW,
    REPORTS_EXPORT,
    SETTINGS_MANAGE,
    TEAM_MANAGE,
    BEATS_MANAGE,
}

ROLES = ("owner", "accountant", "staff")

# Roles that may never write to a business, whatever a route's own check says
# (enforced once, in deps.get_current_membership).
READ_ONLY_ROLES = {"accountant"}
# Non-GET calls a read-only role may still make: they change only the caller's
# own data. Ask AI is a POST but every one of its tools only reads the books.
SELF_SERVICE_WRITES = {
    ("DELETE", "/api/v1/chatbot/history"),
    ("POST", "/api/v1/chatbot/ask"),
    ("POST", "/api/v1/chatbot/feedback"),
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": set(ALL_PERMISSIONS),
    "accountant": {
        DATA_VIEW,
        REPORTS_VIEW,
        REPORTS_EXPORT,
    },
    "staff": {ENTRY_CREATE},
}


def role_can(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
