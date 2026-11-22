package com.demo.service;

import com.demo.dto.UserDTO;
import com.demo.repository.UserRepository;
import com.demo.vo.UserVO;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Service
public class UserService {

    private final UserRepository userRepository;
    private final UserValidator userValidator = new UserValidator();

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public Page<UserVO> queryByPage(int page, int size, String keyword) {
        return userRepository.findByPage(page, size, keyword);
    }

    @org.springframework.transaction.annotation.Transactional
    public Long saveUser(UserDTO dto) {
        userValidator.validate(dto);
        userValidator.checkUsernameUnique(userRepository.findByUsername(dto.getUsername()));
        return userRepository.insert(dto);
    }

    @org.springframework.transaction.annotation.Transactional
    public void updateUser(Long id, UserDTO dto) {
        userValidator.validate(dto);
        userRepository.updateWithVersion(id, dto);
    }

    @org.springframework.transaction.annotation.Transactional
    public void removeUser(Long id) {
        userRepository.markDeleted(id);
        userRepository.removeTokens(id);
    }

    @org.springframework.transaction.annotation.Transactional
    public void changeStatus(Long id, Boolean enabled) {
        if (enabled == null) {
            throw new IllegalArgumentException("状态参数不能为空");
        }
        userRepository.updateStatus(id, enabled);
        if (!enabled) {
            userRepository.removeTokens(id);
        }
    }
}
