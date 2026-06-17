import React from 'react';
import { Link } from 'react-router-dom';
import './ProfileMenu.css';
import { displayNameFromUser } from '../lib/avatarTheme';

function ProfileMenu({ user, onSignOut, onClose, canAccessAdmin = false }) {
  const displayName = displayNameFromUser(user);

  return (
    <div className="profile-menu">
      <div className="profile-menu-header">
        <h4>{displayName}</h4>
        <p>{user?.email || 'Signed in with Google'}</p>
      </div>
      <div className="profile-menu-items">
        <Link to="/dashboard" onClick={onClose}>
          <div className="profile-menu-item">Dashboard</div>
        </Link>
        <Link to="/favourites" onClick={onClose}>
          <div className="profile-menu-item">Favourites</div>
        </Link>
        <Link to="/support" onClick={onClose}>
          <div className="profile-menu-item">Support</div>
        </Link>
        <Link to="/settings" onClick={onClose}>
          <div className="profile-menu-item">Settings</div>
        </Link>
        {canAccessAdmin ? (
          <Link to="/admin" onClick={onClose}>
            <div className="profile-menu-item">Admin Portal</div>
          </Link>
        ) : null}
        <div className="profile-menu-divider"></div>
        <div className="profile-menu-item" onClick={onSignOut}>
          Sign Out
        </div>
      </div>
    </div>
  );
}

export default ProfileMenu;