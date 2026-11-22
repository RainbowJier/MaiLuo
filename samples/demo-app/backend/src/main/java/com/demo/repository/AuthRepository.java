package com.demo.repository;

@org.springframework.stereotype.Repository
public class AuthRepository {

    public boolean matches(String rawPassword, String passwordHash) {
        // 校验 BCrypt 哈希
        return false;
    }

    public String issueToken(Long userId) {
        // INSERT INTO auth_tokens (user_id, token, expire_at) VALUES (...)
        return "";
    }

    public int revokeToken(String token) {
        // DELETE FROM auth_tokens WHERE token = ?
        return 1;
    }

    public Long resolveUserId(String token) {
        // SELECT user_id FROM auth_tokens WHERE token = ? AND expire_at > NOW()
        return null;
    }
}
