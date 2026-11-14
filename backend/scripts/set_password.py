"""Set a new password for an existing Sakuna account (run by the account owner, interactively).

The password is typed at a hidden prompt; it is never printed or stored in plain text. All existing
sessions (refresh tokens) for the account are signed out.

    docker run -it --rm --env-file .env.supabase -v "${PWD}\\backend:/app" -w /app sakuna-api:dev \
        python scripts/set_password.py you@example.com
"""
import sys
from getpass import getpass

from sqlalchemy import delete, select

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.entities import RefreshToken, User


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/set_password.py <email>")
        return 2
    email = sys.argv[1].strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            print(f"No account found for {email}.")
            return 1
        first = getpass(f"New password for {email} (min 8 characters): ")
        if len(first) < 8:
            print("Too short. Nothing changed.")
            return 1
        if getpass("Type it again: ") != first:
            print("The two passwords do not match. Nothing changed.")
            return 1
        user.password_hash = hash_password(first)
        signed_out = db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id)).rowcount
        db.commit()
    print(f"Password updated for {email}. Signed out {signed_out} old session(s). You can sign in now.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
