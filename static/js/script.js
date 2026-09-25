document.addEventListener("DOMContentLoaded", () => {
    const toggles = document.querySelectorAll(".dropdown-toggle");

    toggles.forEach(toggle => {
        toggle.addEventListener("click", (e) => {
            e.preventDefault(); // Stop default anchor jump
            
            const targetId = toggle.getAttribute("data-target");
            const currentDropdown = document.getElementById(targetId);

            // Close any other open dropdown menus
            document.querySelectorAll(".dropdown-menu").forEach(menu => {
                if (menu !== currentDropdown) {
                    menu.classList.remove("show");
                }
            });

            // Toggle the visibility of the targeted child menu
            currentDropdown.classList.toggle("show");
        });
    });

    // Close the dropdown if the user clicks anywhere outside of the navbar
    window.addEventListener("click", (e) => {
        if (!e.target.matches(".dropdown-toggle")) {
            document.querySelectorAll(".dropdown-menu").forEach(menu => {
                menu.classList.remove("show");
            });
        }
    });
});
