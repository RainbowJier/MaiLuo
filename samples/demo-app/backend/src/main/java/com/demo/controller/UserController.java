package com.demo.controller;

import com.demo.dto.UserDTO;
import com.demo.service.UserService;
import com.demo.vo.UserVO;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/user")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/list")
    public Page<UserVO> list(@RequestParam int page, @RequestParam int size,
                             @RequestParam(required = false) String keyword) {
        return userService.queryByPage(page, size, keyword);
    }

    @PostMapping("/create")
    public Long create(@RequestBody UserDTO dto) {
        return userService.saveUser(dto);
    }

    @PutMapping("/{id}")
    public void update(@PathVariable Long id, @RequestBody UserDTO dto) {
        userService.updateUser(id, dto);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        userService.removeUser(id);
    }

    @PutMapping("/{id}/status")
    public void changeStatus(@PathVariable Long id, @RequestBody UserDTO dto) {
        userService.changeStatus(id, dto.getEnabled());
    }
}
