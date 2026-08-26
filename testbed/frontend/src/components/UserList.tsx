import { useState, type ReactElement, type ChangeEvent } from "react";
import type { UserAccount } from "../types.js";

interface UserListProps {
  readonly users: readonly UserAccount[];
  readonly onSelectUser: (user: UserAccount) => void;
}

export function UserList({ users, onSelectUser }: UserListProps): ReactElement {
  const [filterText, setFilterText] = useState("");

  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setFilterText(event.target.value);
  };

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(filterText.toLowerCase()),
  );

  return (
    <div className="user-list-container">
      <h3>User Management</h3>
      <input
        type="text"
        value={filterText}
        onChange={handleFilterChange}
        placeholder="Filter users..."
        tabIndex={5}
      />
      <div>
        {filteredUsers.map((user) => (
          <div key={user.id} className="broken-nav-item" onClick={() => onSelectUser(user)}>
            <span>{user.username}</span>
            <span> ({user.role})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
