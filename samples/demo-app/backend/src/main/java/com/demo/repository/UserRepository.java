package com.demo.repository;

import com.demo.dto.UserDTO;
import com.demo.vo.UserVO;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Repository
public class UserRepository {

    public Page<UserVO> findByPage(int page, int size, String keyword) {
        // SELECT * FROM users WHERE deleted = 0 AND (username LIKE ? OR email LIKE ?)
        return Page.empty();
    }

    public UserVO findByUsername(String username) {
        // SELECT * FROM users WHERE username = ? AND deleted = 0
        return null;
    }

    public Long insert(UserDTO dto) {
        // INSERT INTO users (username, email, role, enabled) VALUES (...)
        return 1L;
    }

    public int updateWithVersion(Long id, UserDTO dto) {
        // UPDATE users SET email=?, role=? WHERE id=? AND version=?
        return 1;
    }

    public int markDeleted(Long id) {
        // UPDATE users SET deleted = 1 WHERE id = ?
        return 1;
    }

    public int updateStatus(Long id, boolean enabled) {
        // UPDATE users SET enabled = ? WHERE id = ?
        return 1;
    }

    public int removeTokens(Long userId) {
        // DELETE FROM auth_tokens WHERE user_id = ?
        return 1;
    }
}
