package com.demo.controller;

import com.demo.dto.LoginDTO;
import com.demo.service.AuthService;
import com.demo.vo.UserVO;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public Object login(@RequestBody LoginDTO dto) {
        return authService.login(dto.getUsername(), dto.getPassword());
    }

    @PostMapping("/logout")
    public void logout(@RequestHeader("Authorization") String authorization) {
        authService.logout(authorization);
    }

    @GetMapping("/profile")
    public UserVO profile(@RequestHeader("Authorization") String authorization) {
        return authService.getProfile(authorization);
    }
}
