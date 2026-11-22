package com.demo.service;

import com.demo.dto.UserDTO;
import com.demo.vo.UserVO;

public class UserValidator {

    public void validate(UserDTO dto) {
        if (dto.getUsername() == null || dto.getUsername().length() < 4) {
            throw new IllegalArgumentException("用户名至少 4 位");
        }
        if (dto.getEmail() == null || !dto.getEmail().matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new IllegalArgumentException("邮箱格式不正确");
        }
    }

    public void checkUsernameUnique(UserVO existing) {
        if (existing != null) {
            throw new IllegalArgumentException("用户名已存在");
        }
    }
}
