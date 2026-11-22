package com.demo.service;

import com.demo.repository.AuthRepository;
import com.demo.repository.UserRepository;
import com.demo.vo.UserVO;

@org.springframework.stereotype.Service
public class AuthService {

    private final UserRepository userRepository;
    private final AuthRepository authRepository;

    public AuthService(UserRepository userRepository, AuthRepository authRepository) {
        this.userRepository = userRepository;
        this.authRepository = authRepository;
    }

    public Object login(String username, String password) {
        if (username == null || password == null || password.isBlank()) {
            throw new IllegalArgumentException("用户名和密码不能为空");
        }
        UserVO user = userRepository.findByUsername(username);
        if (user == null || !authRepository.matches(password, user.getPasswordHash())) {
            throw new IllegalArgumentException("用户名或密码错误");
        }
        if (!user.isEnabled()) {
            throw new IllegalStateException("账号已被禁用");
        }
        String token = authRepository.issueToken(user.getId());
        return java.util.Map.of("token", token, "user", user);
    }

    @org.springframework.transaction.annotation.Transactional
    public void logout(String authorization) {
        authRepository.revokeToken(extractToken(authorization));
    }

    public UserVO getProfile(String authorization) {
        Long userId = authRepository.resolveUserId(extractToken(authorization));
        if (userId == null) {
            throw new IllegalArgumentException("登录已过期");
        }
        return userRepository.findById(userId);
    }

    private String extractToken(String authorization) {
        return authorization == null ? null : authorization.replace("Bearer ", "");
    }
}
